package plugin

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"

	"github.com/greg00r/greg00r-templatehub-app/pkg/plugin/storage"
)

// Route patterns for resource dispatching.
var (
	reTemplatesList   = regexp.MustCompile(`^templates/?$`)
	reTemplateByID    = regexp.MustCompile(`^templates/([^/]+)/?$`)
	reTemplateApprove = regexp.MustCompile(`^templates/([^/]+)/approve/?$`)
	reTemplateImage   = regexp.MustCompile(`^templates/([^/]+)/image/?$`)
	reTemplateJSON    = regexp.MustCompile(`^templates/([^/]+)/template/?$`)
	reTemplateVars    = regexp.MustCompile(`^templates/([^/]+)/variables/?$`)
	reAccess          = regexp.MustCompile(`^access/?$`)
	reHealth          = regexp.MustCompile(`^health/?$`)
	reInitialize      = regexp.MustCompile(`^initialize/?$`)
)

var (
	nonAlphanumRe     = regexp.MustCompile(`[^a-z0-9]+`)
	templateIDRe      = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	templateVersionRe = regexp.MustCompile(`^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$`)
	variableNameRe    = regexp.MustCompile(`^[A-Za-z0-9_:-]+$`)
)

const (
	pluginID            = "greg00r-templatehub-app"
	maxUploadBodyBytes  = 10 << 20
	maxImageBytes       = 2 << 20
	maxTitleLength      = 120
	maxShortDescLength  = 200
	maxLongDescLength   = 12000
	maxFolderLength     = 120
	maxAuthorLength     = 120
	maxTagCount         = 20
	maxTagLength        = 40
	maxDatasourceCount  = 20
	maxVariableCount    = 50
	maxVariableLabelLen = 120
	maxVariableDescLen  = 300
	maxVariableValueLen = 500
	defaultTemplateVer  = "1.0.0"
)

var allowedImageMIMEs = map[string]struct{}{
	"image/png":  {},
	"image/jpeg": {},
	"image/webp": {},
	"image/gif":  {},
}

var allowedVariableTypes = map[string]struct{}{
	"textbox":    {},
	"custom":     {},
	"query":      {},
	"constant":   {},
	"datasource": {},
}

type accessLevel int

const (
	accessViewer accessLevel = iota
	accessEditor
	accessAdmin
)

type authorizationError struct {
	status  int
	message string
}

func (e *authorizationError) Error() string {
	return e.message
}

type parsedUploadTemplate struct {
	templateJSON  []byte
	metadata      TemplateMetadata
	variablesJSON []byte
	imageBytes    []byte
	imageMime     string
}

type jsonUploadTemplateRequest struct {
	TemplateJSON  json.RawMessage  `json:"templateJson"`
	Metadata      TemplateMetadata `json:"metadata"`
	VariablesJSON json.RawMessage  `json:"variablesJson"`
	ImageBase64   string           `json:"imageBase64"`
	ImageMimeType string           `json:"imageMimeType"`
}

// handleResources is the main router for plugin resource calls.
func (p *Plugin) handleResources(rw http.ResponseWriter, req *http.Request, pluginCtx backend.PluginContext) {
	path := normalizeResourcePath(req.URL.Path)
	method := req.Method

	switch {
	case reHealth.MatchString(path) && method == http.MethodGet:
		p.handleHealth(rw)

	case reAccess.MatchString(path) && method == http.MethodGet:
		p.handleGetAccess(rw, req, pluginCtx)

	case reInitialize.MatchString(path) && method == http.MethodPost:
		p.handleInitialize(rw, req, pluginCtx)

	case reTemplatesList.MatchString(path) && method == http.MethodGet:
		p.handleListTemplates(rw, req, pluginCtx)

	case reTemplatesList.MatchString(path) && method == http.MethodPost:
		p.handleUploadTemplate(rw, req, pluginCtx)

	case reTemplateApprove.MatchString(path) && method == http.MethodPost:
		m := reTemplateApprove.FindStringSubmatch(path)
		p.handleApproveTemplate(rw, req, m[1], pluginCtx)

	case reTemplateImage.MatchString(path) && method == http.MethodGet:
		m := reTemplateImage.FindStringSubmatch(path)
		p.handleGetImage(rw, req, m[1], pluginCtx)

	case reTemplateJSON.MatchString(path) && method == http.MethodGet:
		m := reTemplateJSON.FindStringSubmatch(path)
		p.handleGetTemplateJSON(rw, req, m[1], pluginCtx)

	case reTemplateVars.MatchString(path) && method == http.MethodGet:
		m := reTemplateVars.FindStringSubmatch(path)
		p.handleGetVariables(rw, req, m[1], pluginCtx)

	case reTemplateByID.MatchString(path) && method == http.MethodGet:
		m := reTemplateByID.FindStringSubmatch(path)
		p.handleGetMetadata(rw, req, m[1], pluginCtx)

	case reTemplateByID.MatchString(path) && method == http.MethodDelete:
		m := reTemplateByID.FindStringSubmatch(path)
		p.handleDeleteTemplate(rw, req, m[1], pluginCtx)

	default:
		jsonError(rw, "not found", http.StatusNotFound)
	}
}

func normalizeResourcePath(path string) string {
	trimmed := strings.Trim(strings.TrimSpace(path), "/")
	if trimmed == "" {
		return ""
	}

	if idx := strings.Index(trimmed, "/resources/"); idx >= 0 {
		return strings.Trim(trimmed[idx+len("/resources/"):], "/")
	}

	return strings.TrimPrefix(trimmed, "resources/")
}

func requestedTemplateStatus(req *http.Request, defaultStatus TemplateStatus) (TemplateStatus, error) {
	rawStatus := strings.TrimSpace(req.URL.Query().Get("status"))
	if rawStatus == "" {
		return defaultStatus, nil
	}

	switch TemplateStatus(strings.ToLower(rawStatus)) {
	case TemplateStatusPending:
		return TemplateStatusPending, nil
	case TemplateStatusApproved:
		return TemplateStatusApproved, nil
	default:
		return "", fmt.Errorf("unsupported template status %q", rawStatus)
	}
}

func (p *Plugin) requireTemplateStatusAccess(req *http.Request, pluginCtx backend.PluginContext, status TemplateStatus) error {
	if status == TemplateStatusPending {
		return p.requireMarketplaceAccess(req, pluginCtx, actionTemplatesReview, "view pending templates")
	}

	return nil
}

func ensureMetadataStatus(meta TemplateMetadata, status TemplateStatus) TemplateMetadata {
	if meta.Status == "" {
		meta.Status = status
	}

	return meta
}

func templateImageURL(id string, status TemplateStatus) string {
	baseURL := fmt.Sprintf("/api/plugins/%s/resources/templates/%s/image", pluginID, id)
	if status == TemplateStatusPending {
		return baseURL + "?status=pending"
	}

	return baseURL
}

// handleHealth returns 200 OK and pings the storage backend.
func (p *Plugin) handleHealth(rw http.ResponseWriter) {
	if err := p.storage.Ping(); err != nil {
		jsonError(rw, fmt.Sprintf("storage unhealthy: %v", err), http.StatusServiceUnavailable)
		return
	}
	jsonResponse(rw, map[string]string{"status": "ok"}, http.StatusOK)
}

// handleInitialize ensures the storage root exists (local only).
func (p *Plugin) handleInitialize(rw http.ResponseWriter, req *http.Request, pluginCtx backend.PluginContext) {
	if err := p.requireMarketplaceAccess(req, pluginCtx, actionTemplatesInitialize, "initialize plugin storage"); err != nil {
		writeAuthorizationError(rw, err)
		return
	}

	if err := p.storage.Ping(); err != nil {
		jsonError(rw, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(rw, map[string]string{"status": "initialized"}, http.StatusOK)
}

// handleListTemplates returns templates from the requested queue as a JSON array.
func (p *Plugin) handleListTemplates(rw http.ResponseWriter, req *http.Request, pluginCtx backend.PluginContext) {
	status, err := requestedTemplateStatus(req, TemplateStatusApproved)
	if err != nil {
		jsonError(rw, err.Error(), http.StatusBadRequest)
		return
	}
	if err := p.requireTemplateStatusAccess(req, pluginCtx, status); err != nil {
		writeAuthorizationError(rw, err)
		return
	}

	metadataBlobs, err := p.storage.ListTemplates(storage.TemplateState(status))
	if err != nil {
		jsonError(rw, err.Error(), http.StatusInternalServerError)
		return
	}

	templates := make([]Template, 0, len(metadataBlobs))
	for _, blob := range metadataBlobs {
		var typedTemplates []Template
		if err := json.Unmarshal(blob, &typedTemplates); err == nil {
			templates = append(templates, typedTemplates...)
			continue
		}

		var typedMetadata []TemplateMetadata
		if err := json.Unmarshal(blob, &typedMetadata); err == nil {
			for _, meta := range typedMetadata {
				meta = ensureMetadataStatus(meta, status)
				templates = append(templates, Template{
					Metadata: meta,
					ImageURL: templateImageURL(meta.ID, status),
				})
			}
			continue
		}

		var meta TemplateMetadata
		if err := json.Unmarshal(blob, &meta); err != nil {
			continue
		}
		meta = ensureMetadataStatus(meta, status)
		templates = append(templates, Template{
			Metadata: meta,
			ImageURL: templateImageURL(meta.ID, status),
		})
	}

	sort.Slice(templates, func(i, j int) bool {
		return strings.ToLower(templates[i].Metadata.Title) < strings.ToLower(templates[j].Metadata.Title)
	})

	jsonResponse(rw, templates, http.StatusOK)
}

// handleGetMetadata returns metadata.json for a single template.
func (p *Plugin) handleGetMetadata(rw http.ResponseWriter, req *http.Request, id string, pluginCtx backend.PluginContext) {
	status, err := requestedTemplateStatus(req, TemplateStatusApproved)
	if err != nil {
		jsonError(rw, err.Error(), http.StatusBadRequest)
		return
	}
	if err := p.requireTemplateStatusAccess(req, pluginCtx, status); err != nil {
		writeAuthorizationError(rw, err)
		return
	}

	data, err := p.storage.GetMetadata(id, storage.TemplateState(status))
	if err != nil {
		writeStorageError(rw, err)
		return
	}

	var meta TemplateMetadata
	if err := json.Unmarshal(data, &meta); err != nil {
		jsonError(rw, "invalid metadata stored for template", http.StatusInternalServerError)
		return
	}

	jsonResponse(rw, ensureMetadataStatus(meta, status), http.StatusOK)
}

// handleGetTemplateJSON returns template.json (dashboard model).
func (p *Plugin) handleGetTemplateJSON(rw http.ResponseWriter, req *http.Request, id string, pluginCtx backend.PluginContext) {
	status, err := requestedTemplateStatus(req, TemplateStatusApproved)
	if err != nil {
		jsonError(rw, err.Error(), http.StatusBadRequest)
		return
	}
	if err := p.requireTemplateStatusAccess(req, pluginCtx, status); err != nil {
		writeAuthorizationError(rw, err)
		return
	}

	data, err := p.storage.GetTemplate(id, storage.TemplateState(status))
	if err != nil {
		writeStorageError(rw, err)
		return
	}
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(http.StatusOK)
	_, _ = rw.Write(data)
}

// handleGetVariables returns variables.json for a template.
func (p *Plugin) handleGetVariables(rw http.ResponseWriter, req *http.Request, id string, pluginCtx backend.PluginContext) {
	status, err := requestedTemplateStatus(req, TemplateStatusApproved)
	if err != nil {
		jsonError(rw, err.Error(), http.StatusBadRequest)
		return
	}
	if err := p.requireTemplateStatusAccess(req, pluginCtx, status); err != nil {
		writeAuthorizationError(rw, err)
		return
	}

	data, err := p.storage.GetVariables(id, storage.TemplateState(status))
	if err != nil {
		writeStorageError(rw, err)
		return
	}
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(http.StatusOK)
	_, _ = rw.Write(data)
}

// handleGetImage streams the template image.
func (p *Plugin) handleGetImage(rw http.ResponseWriter, req *http.Request, id string, pluginCtx backend.PluginContext) {
	status, err := requestedTemplateStatus(req, TemplateStatusApproved)
	if err != nil {
		jsonError(rw, err.Error(), http.StatusBadRequest)
		return
	}
	if err := p.requireTemplateStatusAccess(req, pluginCtx, status); err != nil {
		writeAuthorizationError(rw, err)
		return
	}

	data, mimeType, err := p.storage.GetImage(id, storage.TemplateState(status))
	if err != nil {
		writeStorageError(rw, err)
		return
	}
	rw.Header().Set("Content-Type", mimeType)
	rw.Header().Set("Cache-Control", "public, max-age=86400")
	rw.WriteHeader(http.StatusOK)
	_, _ = rw.Write(data)
}

// handleUploadTemplate handles new template uploads with backend authorization and validation.
func (p *Plugin) handleUploadTemplate(rw http.ResponseWriter, req *http.Request, pluginCtx backend.PluginContext) {
	if err := p.requireMarketplaceAccess(req, pluginCtx, actionTemplatesPublish, "publish templates"); err != nil {
		writeAuthorizationError(rw, err)
		return
	}

	if req.ContentLength > maxUploadBodyBytes {
		jsonError(rw, fmt.Sprintf("upload exceeds %d MB limit", maxUploadBodyBytes/(1<<20)), http.StatusRequestEntityTooLarge)
		return
	}

	contentType := req.Header.Get("Content-Type")
	parsedUpload, err := parseUploadTemplateRequest(req, contentType)
	if err != nil {
		p.logger.Error("failed to parse upload request", "contentType", contentType, "error", err)
		jsonError(rw, err.Error(), http.StatusBadRequest)
		return
	}

	actor := actorFromPluginContext(pluginCtx)
	applyUploadDefaults(parsedUpload, actor)

	if err := validateUploadTemplate(parsedUpload); err != nil {
		p.logger.Warn("upload rejected during validation", "templateId", parsedUpload.metadata.ID, "error", err)
		jsonError(rw, err.Error(), http.StatusBadRequest)
		return
	}

	exists, err := p.storage.TemplateExists(parsedUpload.metadata.ID)
	if err != nil {
		p.logger.Error("failed checking template existence", "templateId", parsedUpload.metadata.ID, "error", err)
		jsonError(rw, "checking template existence failed", http.StatusInternalServerError)
		return
	}
	if exists {
		jsonError(
			rw,
			fmt.Sprintf("template %q already exists. Choose a different title or bump the version and publish under a new template ID.", parsedUpload.metadata.ID),
			http.StatusConflict,
		)
		return
	}

	enrichedMeta, err := json.Marshal(parsedUpload.metadata)
	if err != nil {
		p.logger.Error("failed to marshal upload metadata", "templateId", parsedUpload.metadata.ID, "error", err)
		jsonError(rw, "re-marshalling metadata: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var imageReader io.Reader
	if len(parsedUpload.imageBytes) > 0 {
		imageReader = bytes.NewReader(parsedUpload.imageBytes)
	}

	if err := p.storage.SaveTemplate(
		parsedUpload.metadata.ID,
		storage.TemplateStatePending,
		parsedUpload.templateJSON,
		enrichedMeta,
		parsedUpload.variablesJSON,
		imageReader,
		parsedUpload.imageMime,
	); err != nil {
		p.logger.Error("failed to save uploaded template", "templateId", parsedUpload.metadata.ID, "error", err)
		writeStorageError(rw, err)
		return
	}

	p.logger.Info(
		"template uploaded successfully",
		"templateId", parsedUpload.metadata.ID,
		"uploadedBy", actor,
		"hasImage", len(parsedUpload.imageBytes) > 0,
	)
	jsonResponse(rw, parsedUpload.metadata, http.StatusCreated)
}

func (p *Plugin) handleApproveTemplate(rw http.ResponseWriter, req *http.Request, id string, pluginCtx backend.PluginContext) {
	if err := p.requireMarketplaceAccess(req, pluginCtx, actionTemplatesApprove, "approve templates"); err != nil {
		writeAuthorizationError(rw, err)
		return
	}

	data, err := p.storage.GetMetadata(id, storage.TemplateStatePending)
	if err != nil {
		writeStorageError(rw, err)
		return
	}

	var metadata TemplateMetadata
	if err := json.Unmarshal(data, &metadata); err != nil {
		jsonError(rw, "invalid pending template metadata", http.StatusInternalServerError)
		return
	}

	actor := actorFromPluginContext(pluginCtx)
	now := time.Now().UTC().Format("2006-01-02")
	metadata.Status = TemplateStatusApproved
	metadata.ApprovedAt = now
	metadata.ApprovedBy = actor
	metadata.UpdatedAt = now
	metadata.UpdatedBy = actor

	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		jsonError(rw, "failed to serialize approved metadata", http.StatusInternalServerError)
		return
	}

	if err := p.storage.ApproveTemplate(id, metadataJSON); err != nil {
		writeStorageError(rw, err)
		return
	}

	jsonResponse(rw, metadata, http.StatusOK)
}

// handleDeleteTemplate removes a template from storage.
func (p *Plugin) handleDeleteTemplate(rw http.ResponseWriter, req *http.Request, id string, pluginCtx backend.PluginContext) {
	if err := p.requireMarketplaceAccess(req, pluginCtx, actionTemplatesDelete, "delete templates"); err != nil {
		writeAuthorizationError(rw, err)
		return
	}

	status, err := requestedTemplateStatus(req, TemplateStatusApproved)
	if err != nil {
		jsonError(rw, err.Error(), http.StatusBadRequest)
		return
	}

	if err := p.storage.DeleteTemplate(id, storage.TemplateState(status)); err != nil {
		writeStorageError(rw, err)
		return
	}
	rw.WriteHeader(http.StatusNoContent)
}

func jsonResponse(rw http.ResponseWriter, v interface{}, status int) {
	data, err := json.Marshal(v)
	if err != nil {
		http.Error(rw, "serialization error", http.StatusInternalServerError)
		return
	}
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(status)
	_, _ = rw.Write(data)
}

func jsonError(rw http.ResponseWriter, message string, status int) {
	jsonResponse(rw, map[string]string{"error": message}, status)
}

func writeAuthorizationError(rw http.ResponseWriter, err error) {
	var authErr *authorizationError
	if errors.As(err, &authErr) {
		jsonError(rw, authErr.message, authErr.status)
		return
	}

	jsonError(rw, "access denied", http.StatusForbidden)
}

func writeStorageError(rw http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storage.ErrTemplateNotFound):
		jsonError(rw, err.Error(), http.StatusNotFound)
	case errors.Is(err, storage.ErrTemplateAlreadyExists):
		jsonError(rw, err.Error(), http.StatusConflict)
	default:
		jsonError(rw, err.Error(), http.StatusInternalServerError)
	}
}

func requireMinimumRole(pluginCtx backend.PluginContext, minimum accessLevel, action string) error {
	if pluginCtx.User == nil {
		return &authorizationError{
			status:  http.StatusUnauthorized,
			message: fmt.Sprintf("authentication is required to %s", action),
		}
	}

	if roleLevel(pluginCtx.User.Role) < minimum {
		return &authorizationError{
			status:  http.StatusForbidden,
			message: fmt.Sprintf("%s role or higher is required to %s", roleName(minimum), action),
		}
	}

	return nil
}

func roleLevel(role string) accessLevel {
	switch strings.ToLower(strings.ReplaceAll(strings.TrimSpace(role), " ", "")) {
	case "admin", "grafanaadmin", "serveradmin":
		return accessAdmin
	case "editor":
		return accessEditor
	default:
		return accessViewer
	}
}

func roleName(level accessLevel) string {
	switch level {
	case accessAdmin:
		return "Admin"
	case accessEditor:
		return "Editor"
	default:
		return "Viewer"
	}
}

func actorFromPluginContext(pluginCtx backend.PluginContext) string {
	if pluginCtx.User == nil {
		return "system"
	}
	if value := strings.TrimSpace(pluginCtx.User.Name); value != "" {
		return value
	}
	if value := strings.TrimSpace(pluginCtx.User.Login); value != "" {
		return value
	}
	if value := strings.TrimSpace(pluginCtx.User.Email); value != "" {
		return value
	}
	return "system"
}

func applyUploadDefaults(parsedUpload *parsedUploadTemplate, actor string) {
	now := time.Now().UTC().Format("2006-01-02")

	parsedUpload.metadata.Title = strings.TrimSpace(parsedUpload.metadata.Title)
	parsedUpload.metadata.ShortDescription = strings.TrimSpace(parsedUpload.metadata.ShortDescription)
	parsedUpload.metadata.LongDescription = strings.TrimSpace(parsedUpload.metadata.LongDescription)
	parsedUpload.metadata.Folder = strings.TrimSpace(parsedUpload.metadata.Folder)
	parsedUpload.metadata.Author = strings.TrimSpace(parsedUpload.metadata.Author)
	parsedUpload.metadata.Version = strings.TrimSpace(parsedUpload.metadata.Version)
	parsedUpload.metadata.ID = strings.TrimSpace(parsedUpload.metadata.ID)

	if parsedUpload.metadata.Version == "" {
		parsedUpload.metadata.Version = defaultTemplateVer
	}
	if parsedUpload.metadata.ID == "" && parsedUpload.metadata.Title != "" {
		parsedUpload.metadata.ID = buildTemplateID(parsedUpload.metadata.Title, parsedUpload.metadata.Version)
	}
	parsedUpload.metadata.Author = actor
	parsedUpload.metadata.Status = TemplateStatusPending
	parsedUpload.metadata.ApprovedAt = ""
	parsedUpload.metadata.ApprovedBy = ""
	if parsedUpload.metadata.CreatedAt == "" {
		parsedUpload.metadata.CreatedAt = now
	}
	if parsedUpload.metadata.CreatedBy == "" {
		parsedUpload.metadata.CreatedBy = actor
	}

	parsedUpload.metadata.UpdatedAt = now
	parsedUpload.metadata.UpdatedBy = actor
}

func validateUploadTemplate(parsedUpload *parsedUploadTemplate) error {
	if err := validateDashboardJSON(parsedUpload.templateJSON); err != nil {
		return err
	}

	if err := validateTemplateMetadata(&parsedUpload.metadata); err != nil {
		return err
	}

	normalizedVariables, err := normalizeVariablesJSON(parsedUpload.variablesJSON)
	if err != nil {
		return err
	}
	parsedUpload.variablesJSON = normalizedVariables

	normalizedImageMime, err := validateImagePayload(parsedUpload.imageBytes, parsedUpload.imageMime)
	if err != nil {
		return err
	}
	parsedUpload.imageMime = normalizedImageMime

	return nil
}

func validateDashboardJSON(templateJSON []byte) error {
	if len(templateJSON) == 0 {
		return fmt.Errorf("templateJson is required")
	}

	var dashboard map[string]interface{}
	if err := json.Unmarshal(templateJSON, &dashboard); err != nil {
		return fmt.Errorf("templateJson must be valid JSON: %w", err)
	}

	title, ok := dashboard["title"].(string)
	if !ok || strings.TrimSpace(title) == "" {
		return fmt.Errorf("templateJson must contain a dashboard title")
	}

	return nil
}

func validateTemplateMetadata(meta *TemplateMetadata) error {
	if meta.Title == "" {
		return fmt.Errorf("metadata.title is required")
	}
	if len(meta.Title) > maxTitleLength {
		return fmt.Errorf("metadata.title must be %d characters or fewer", maxTitleLength)
	}
	if meta.ShortDescription == "" {
		return fmt.Errorf("metadata.shortDescription is required")
	}
	if len(meta.ShortDescription) > maxShortDescLength {
		return fmt.Errorf("metadata.shortDescription must be %d characters or fewer", maxShortDescLength)
	}
	if len(meta.LongDescription) > maxLongDescLength {
		return fmt.Errorf("metadata.longDescription must be %d characters or fewer", maxLongDescLength)
	}
	if len(meta.Folder) > maxFolderLength {
		return fmt.Errorf("metadata.folder must be %d characters or fewer", maxFolderLength)
	}
	if meta.ID == "" {
		return fmt.Errorf("metadata.id could not be generated")
	}
	if len(meta.ID) > 80 {
		return fmt.Errorf("metadata.id must be 80 characters or fewer")
	}
	if !templateIDRe.MatchString(meta.ID) {
		return fmt.Errorf("metadata.id must contain only lowercase letters, digits, and single dashes")
	}
	if meta.Version == "" {
		return fmt.Errorf("metadata.version is required")
	}
	if !templateVersionRe.MatchString(meta.Version) {
		return fmt.Errorf("metadata.version must look like 1.2.3")
	}
	if len(meta.Author) > maxAuthorLength {
		return fmt.Errorf("metadata.author must be %d characters or fewer", maxAuthorLength)
	}

	seenTags := make(map[string]struct{}, len(meta.Tags))
	normalizedTags := make([]string, 0, len(meta.Tags))
	for _, tag := range meta.Tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		if len(tag) > maxTagLength {
			return fmt.Errorf("metadata.tags entries must be %d characters or fewer", maxTagLength)
		}
		key := strings.ToLower(tag)
		if _, exists := seenTags[key]; exists {
			continue
		}
		seenTags[key] = struct{}{}
		normalizedTags = append(normalizedTags, tag)
	}
	if len(normalizedTags) > maxTagCount {
		return fmt.Errorf("metadata.tags supports at most %d entries", maxTagCount)
	}
	meta.Tags = normalizedTags

	if len(meta.RequiredDatasources) > maxDatasourceCount {
		return fmt.Errorf("metadata.requiredDatasources supports at most %d entries", maxDatasourceCount)
	}
	for i := range meta.RequiredDatasources {
		item := &meta.RequiredDatasources[i]
		item.Type = strings.TrimSpace(item.Type)
		item.Name = strings.TrimSpace(item.Name)
		if item.Type == "" || item.Name == "" {
			return fmt.Errorf("metadata.requiredDatasources entries must include both type and name")
		}
	}

	return nil
}

func normalizeVariablesJSON(variablesJSON []byte) ([]byte, error) {
	if len(variablesJSON) == 0 {
		return []byte(`{"variables":[]}`), nil
	}

	decoder := json.NewDecoder(bytes.NewReader(variablesJSON))
	decoder.DisallowUnknownFields()

	var payload TemplateVariables
	if err := decoder.Decode(&payload); err != nil {
		return nil, fmt.Errorf("variablesJson is invalid: %w", err)
	}

	if len(payload.Variables) > maxVariableCount {
		return nil, fmt.Errorf("variablesJson supports at most %d variables", maxVariableCount)
	}

	seenNames := make(map[string]struct{}, len(payload.Variables))
	for i := range payload.Variables {
		variable := &payload.Variables[i]
		variable.Name = strings.TrimSpace(variable.Name)
		variable.Label = strings.TrimSpace(variable.Label)
		variable.Description = strings.TrimSpace(variable.Description)
		variable.Default = strings.TrimSpace(variable.Default)
		variable.Type = strings.TrimSpace(variable.Type)
		variable.Datasource = strings.TrimSpace(variable.Datasource)
		variable.Query = strings.TrimSpace(variable.Query)
		variable.DatasourceType = strings.TrimSpace(variable.DatasourceType)

		if variable.Name == "" {
			return nil, fmt.Errorf("variablesJson variables[%d].name is required", i)
		}
		if !variableNameRe.MatchString(variable.Name) {
			return nil, fmt.Errorf("variablesJson variables[%d].name may contain only letters, digits, underscores, colons, and dashes", i)
		}
		if _, exists := seenNames[variable.Name]; exists {
			return nil, fmt.Errorf("variablesJson contains duplicate variable name %q", variable.Name)
		}
		seenNames[variable.Name] = struct{}{}

		if variable.Label == "" {
			variable.Label = variable.Name
		}
		if len(variable.Label) > maxVariableLabelLen {
			return nil, fmt.Errorf("variablesJson variables[%d].label must be %d characters or fewer", i, maxVariableLabelLen)
		}
		if len(variable.Description) > maxVariableDescLen {
			return nil, fmt.Errorf("variablesJson variables[%d].description must be %d characters or fewer", i, maxVariableDescLen)
		}
		if len(variable.Default) > maxVariableValueLen {
			return nil, fmt.Errorf("variablesJson variables[%d].default must be %d characters or fewer", i, maxVariableValueLen)
		}
		if _, ok := allowedVariableTypes[variable.Type]; !ok {
			return nil, fmt.Errorf("variablesJson variables[%d].type %q is not supported", i, variable.Type)
		}

		if variable.Type == "custom" {
			normalizedOptions := make([]string, 0, len(variable.Options))
			for _, option := range variable.Options {
				option = strings.TrimSpace(option)
				if option == "" {
					continue
				}
				normalizedOptions = append(normalizedOptions, option)
			}
			if len(normalizedOptions) == 0 {
				return nil, fmt.Errorf("variablesJson variables[%d].options must contain at least one value for custom variables", i)
			}
			variable.Options = normalizedOptions
		}
	}

	normalizedJSON, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("re-marshalling variablesJson: %w", err)
	}

	return normalizedJSON, nil
}

func validateImagePayload(imageBytes []byte, imageMime string) (string, error) {
	if len(imageBytes) == 0 {
		return "", nil
	}
	if len(imageBytes) > maxImageBytes {
		return "", fmt.Errorf("image must be %d MB or smaller", maxImageBytes/(1<<20))
	}

	detectedMime := http.DetectContentType(imageBytes)
	if _, ok := allowedImageMIMEs[detectedMime]; !ok {
		return "", fmt.Errorf("image type %q is not supported", detectedMime)
	}

	if imageMime != "" {
		imageMime = strings.ToLower(strings.TrimSpace(imageMime))
		if _, ok := allowedImageMIMEs[imageMime]; !ok {
			return "", fmt.Errorf("image MIME type %q is not supported", imageMime)
		}
	}

	return detectedMime, nil
}

func parseUploadTemplateRequest(req *http.Request, contentType string) (*parsedUploadTemplate, error) {
	if strings.Contains(contentType, "application/json") {
		return parseJSONUploadTemplateRequest(req)
	}

	return parseMultipartUploadTemplateRequest(req)
}

func parseMultipartUploadTemplateRequest(req *http.Request) (*parsedUploadTemplate, error) {
	if err := req.ParseMultipartForm(maxUploadBodyBytes); err != nil {
		return nil, fmt.Errorf("parsing multipart form: %w", err)
	}

	templateJSON := []byte(req.FormValue("templateJson"))
	metadataJSON := []byte(req.FormValue("metadata"))
	variablesJSON := []byte(req.FormValue("variablesJson"))

	if len(templateJSON) == 0 {
		return nil, fmt.Errorf("templateJson is required")
	}
	if len(metadataJSON) == 0 {
		return nil, fmt.Errorf("metadata is required")
	}

	meta, err := decodeTemplateMetadata(metadataJSON)
	if err != nil {
		return nil, err
	}

	var imageBytes []byte
	var imageMime string
	imageFile, imageHeader, imgErr := req.FormFile("image")
	if imgErr == nil {
		defer imageFile.Close()

		imageBytes, err = io.ReadAll(imageFile)
		if err != nil {
			return nil, fmt.Errorf("reading image: %w", err)
		}

		imageMime = imageHeader.Header.Get("Content-Type")
		if imageMime == "" {
			imageMime = "image/png"
		}
	}

	return &parsedUploadTemplate{
		templateJSON:  templateJSON,
		metadata:      meta,
		variablesJSON: variablesJSON,
		imageBytes:    imageBytes,
		imageMime:     imageMime,
	}, nil
}

func parseJSONUploadTemplateRequest(req *http.Request) (*parsedUploadTemplate, error) {
	decoder := json.NewDecoder(req.Body)
	decoder.DisallowUnknownFields()

	var payload jsonUploadTemplateRequest
	if err := decoder.Decode(&payload); err != nil {
		return nil, fmt.Errorf("invalid JSON body: %w", err)
	}

	if len(payload.TemplateJSON) == 0 {
		return nil, fmt.Errorf("templateJson is required")
	}

	var imageBytes []byte
	imageMime := payload.ImageMimeType
	if payload.ImageBase64 != "" {
		decodedBytes, err := base64.StdEncoding.DecodeString(payload.ImageBase64)
		if err != nil {
			return nil, fmt.Errorf("invalid imageBase64: %w", err)
		}
		imageBytes = decodedBytes
		if imageMime == "" {
			imageMime = "image/png"
		}
	}

	return &parsedUploadTemplate{
		templateJSON:  payload.TemplateJSON,
		metadata:      payload.Metadata,
		variablesJSON: payload.VariablesJSON,
		imageBytes:    imageBytes,
		imageMime:     imageMime,
	}, nil
}

func decodeTemplateMetadata(metadataJSON []byte) (TemplateMetadata, error) {
	decoder := json.NewDecoder(bytes.NewReader(metadataJSON))
	decoder.DisallowUnknownFields()

	var meta TemplateMetadata
	if err := decoder.Decode(&meta); err != nil {
		return TemplateMetadata{}, fmt.Errorf("invalid metadata JSON: %w", err)
	}

	return meta, nil
}

// slugify converts a title into a URL-safe lowercase slug.
func slugify(title string) string {
	s := strings.ToLower(title)
	s = nonAlphanumRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = fmt.Sprintf("template-%d", time.Now().UnixMilli())
	}
	return s
}

func buildTemplateID(title, version string) string {
	base := slugify(title)
	versionSlug := slugify(version)
	if versionSlug == "" {
		return base
	}

	maxBaseLength := 80 - len(versionSlug) - 1
	if maxBaseLength < 1 {
		maxBaseLength = 1
	}
	if len(base) > maxBaseLength {
		base = strings.Trim(base[:maxBaseLength], "-")
	}
	if base == "" {
		base = "template"
	}

	return fmt.Sprintf("%s-%s", base, versionSlug)
}
