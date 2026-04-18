package plugin

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// Route patterns for resource dispatching.
var (
	reTemplatesList = regexp.MustCompile(`^templates/?$`)
	reTemplateByID  = regexp.MustCompile(`^templates/([^/]+)/?$`)
	reTemplateImage = regexp.MustCompile(`^templates/([^/]+)/image/?$`)
	reTemplateJSON  = regexp.MustCompile(`^templates/([^/]+)/template/?$`)
	reTemplateVars  = regexp.MustCompile(`^templates/([^/]+)/variables/?$`)
	reHealth        = regexp.MustCompile(`^health/?$`)
	reInitialize    = regexp.MustCompile(`^initialize/?$`)
)

const pluginID = "gregoor-private-marketplace-app"

// handleResources is the main router for plugin resource calls.
func (p *Plugin) handleResources(rw http.ResponseWriter, req *http.Request) {
	path := normalizeResourcePath(req.URL.Path)
	method := req.Method

	switch {
	case reHealth.MatchString(path) && method == http.MethodGet:
		p.handleHealth(rw, req)

	case reInitialize.MatchString(path) && method == http.MethodPost:
		p.handleInitialize(rw, req)

	case reTemplatesList.MatchString(path) && method == http.MethodGet:
		p.handleListTemplates(rw, req)

	case reTemplatesList.MatchString(path) && method == http.MethodPost:
		p.handleUploadTemplate(rw, req)

	case reTemplateImage.MatchString(path) && method == http.MethodGet:
		m := reTemplateImage.FindStringSubmatch(path)
		p.handleGetImage(rw, req, m[1])

	case reTemplateJSON.MatchString(path) && method == http.MethodGet:
		m := reTemplateJSON.FindStringSubmatch(path)
		p.handleGetTemplateJSON(rw, req, m[1])

	case reTemplateVars.MatchString(path) && method == http.MethodGet:
		m := reTemplateVars.FindStringSubmatch(path)
		p.handleGetVariables(rw, req, m[1])

	case reTemplateByID.MatchString(path) && method == http.MethodGet:
		m := reTemplateByID.FindStringSubmatch(path)
		p.handleGetMetadata(rw, req, m[1])

	case reTemplateByID.MatchString(path) && method == http.MethodDelete:
		m := reTemplateByID.FindStringSubmatch(path)
		p.handleDeleteTemplate(rw, req, m[1])

	default:
		http.Error(rw, "not found", http.StatusNotFound)
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

// handleHealth returns 200 OK and pings the storage backend.
func (p *Plugin) handleHealth(rw http.ResponseWriter, _ *http.Request) {
	if err := p.storage.Ping(); err != nil {
		jsonError(rw, fmt.Sprintf("storage unhealthy: %v", err), http.StatusServiceUnavailable)
		return
	}
	jsonResponse(rw, map[string]string{"status": "ok"}, http.StatusOK)
}

// handleInitialize ensures the storage root exists (local only).
func (p *Plugin) handleInitialize(rw http.ResponseWriter, _ *http.Request) {
	// For local storage, NewLocalStorage already creates the directory.
	// Calling Ping verifies it's accessible.
	if err := p.storage.Ping(); err != nil {
		jsonError(rw, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(rw, map[string]string{"status": "initialized"}, http.StatusOK)
}

// handleListTemplates returns all templates as a JSON array.
func (p *Plugin) handleListTemplates(rw http.ResponseWriter, _ *http.Request) {
	metadataBlobs, err := p.storage.ListTemplates()
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
				templates = append(templates, Template{
					Metadata: meta,
					ImageURL: fmt.Sprintf("/api/plugins/%s/resources/templates/%s/image", pluginID, meta.ID),
				})
			}
			continue
		}

		var meta TemplateMetadata
		if err := json.Unmarshal(blob, &meta); err != nil {
			continue
		}
		templates = append(templates, Template{
			Metadata: meta,
			ImageURL: fmt.Sprintf("/api/plugins/%s/resources/templates/%s/image", pluginID, meta.ID),
		})
	}

	jsonResponse(rw, templates, http.StatusOK)
}

// handleGetMetadata returns metadata.json for a single template.
func (p *Plugin) handleGetMetadata(rw http.ResponseWriter, _ *http.Request, id string) {
	data, err := p.storage.GetMetadata(id)
	if err != nil {
		jsonError(rw, err.Error(), http.StatusNotFound)
		return
	}
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(http.StatusOK)
	_, _ = rw.Write(data)
}

// handleGetTemplateJSON returns template.json (dashboard model).
func (p *Plugin) handleGetTemplateJSON(rw http.ResponseWriter, _ *http.Request, id string) {
	data, err := p.storage.GetTemplate(id)
	if err != nil {
		jsonError(rw, err.Error(), http.StatusNotFound)
		return
	}
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(http.StatusOK)
	_, _ = rw.Write(data)
}

// handleGetVariables returns variables.json for a template.
func (p *Plugin) handleGetVariables(rw http.ResponseWriter, _ *http.Request, id string) {
	data, err := p.storage.GetVariables(id)
	if err != nil {
		jsonError(rw, err.Error(), http.StatusNotFound)
		return
	}
	rw.Header().Set("Content-Type", "application/json")
	rw.WriteHeader(http.StatusOK)
	_, _ = rw.Write(data)
}

// handleGetImage streams the template image.
func (p *Plugin) handleGetImage(rw http.ResponseWriter, _ *http.Request, id string) {
	data, mimeType, err := p.storage.GetImage(id)
	if err != nil {
		http.Error(rw, err.Error(), http.StatusNotFound)
		return
	}
	rw.Header().Set("Content-Type", mimeType)
	rw.Header().Set("Cache-Control", "public, max-age=86400")
	rw.WriteHeader(http.StatusOK)
	_, _ = rw.Write(data)
}

// handleUploadTemplate handles multipart/form-data POST for new templates.
func (p *Plugin) handleUploadTemplate(rw http.ResponseWriter, req *http.Request) {
	contentType := req.Header.Get("Content-Type")
	parsedUpload, err := parseUploadTemplateRequest(req, contentType)
	if err != nil {
		p.logger.Error("failed to parse upload request", "contentType", contentType, "error", err)
		jsonError(rw, err.Error(), http.StatusBadRequest)
		return
	}

	if parsedUpload.metadata.Title == "" {
		p.logger.Warn("upload rejected because metadata.title is missing")
		jsonError(rw, "metadata.title is required", http.StatusBadRequest)
		return
	}

	if parsedUpload.metadata.ID == "" {
		parsedUpload.metadata.ID = slugify(parsedUpload.metadata.Title)
	}

	now := time.Now().UTC().Format("2006-01-02")
	if parsedUpload.metadata.CreatedAt == "" {
		parsedUpload.metadata.CreatedAt = now
	}
	parsedUpload.metadata.UpdatedAt = now

	enrichedMeta, err := json.Marshal(parsedUpload.metadata)
	if err != nil {
		p.logger.Error("failed to marshal upload metadata", "templateId", parsedUpload.metadata.ID, "error", err)
		jsonError(rw, "re-marshalling metadata: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if len(parsedUpload.variablesJSON) == 0 {
		parsedUpload.variablesJSON = []byte(`{"variables":[]}`)
	}

	if err := p.storage.SaveTemplate(
		parsedUpload.metadata.ID,
		parsedUpload.templateJSON,
		enrichedMeta,
		parsedUpload.variablesJSON,
		parsedUpload.imageReader,
		parsedUpload.imageMime,
	); err != nil {
		p.logger.Error("failed to save uploaded template", "templateId", parsedUpload.metadata.ID, "error", err)
		jsonError(rw, "saving template: "+err.Error(), http.StatusInternalServerError)
		return
	}

	p.logger.Info("template uploaded successfully", "templateId", parsedUpload.metadata.ID, "hasImage", parsedUpload.imageReader != nil)
	jsonResponse(rw, parsedUpload.metadata, http.StatusCreated)
}

// handleDeleteTemplate removes a template from storage.
func (p *Plugin) handleDeleteTemplate(rw http.ResponseWriter, _ *http.Request, id string) {
	if err := p.storage.DeleteTemplate(id); err != nil {
		jsonError(rw, err.Error(), http.StatusInternalServerError)
		return
	}
	rw.WriteHeader(http.StatusNoContent)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

var nonAlphanumRe = regexp.MustCompile(`[^a-z0-9]+`)

type parsedUploadTemplate struct {
	templateJSON  []byte
	metadata      TemplateMetadata
	variablesJSON []byte
	imageReader   io.Reader
	imageMime     string
}

type jsonUploadTemplateRequest struct {
	TemplateJSON  json.RawMessage  `json:"templateJson"`
	Metadata      TemplateMetadata `json:"metadata"`
	VariablesJSON json.RawMessage  `json:"variablesJson"`
	ImageBase64   string           `json:"imageBase64"`
	ImageMimeType string           `json:"imageMimeType"`
}

func parseUploadTemplateRequest(req *http.Request, contentType string) (*parsedUploadTemplate, error) {
	if strings.Contains(contentType, "application/json") {
		return parseJSONUploadTemplateRequest(req)
	}

	return parseMultipartUploadTemplateRequest(req)
}

func parseMultipartUploadTemplateRequest(req *http.Request) (*parsedUploadTemplate, error) {
	if err := req.ParseMultipartForm(20 << 20); err != nil {
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

	var meta TemplateMetadata
	if err := json.Unmarshal(metadataJSON, &meta); err != nil {
		return nil, fmt.Errorf("invalid metadata JSON: %w", err)
	}

	var imageReader io.Reader
	var imageMime string
	imageFile, imageHeader, imgErr := req.FormFile("image")
	if imgErr == nil {
		defer imageFile.Close()

		imageBytes, err := io.ReadAll(imageFile)
		if err != nil {
			return nil, fmt.Errorf("reading image: %w", err)
		}

		imageReader = bytes.NewReader(imageBytes)
		imageMime = imageHeader.Header.Get("Content-Type")
		if imageMime == "" {
			imageMime = "image/png"
		}
	}

	return &parsedUploadTemplate{
		templateJSON:  templateJSON,
		metadata:      meta,
		variablesJSON: variablesJSON,
		imageReader:   imageReader,
		imageMime:     imageMime,
	}, nil
}

func parseJSONUploadTemplateRequest(req *http.Request) (*parsedUploadTemplate, error) {
	var payload jsonUploadTemplateRequest
	if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("invalid JSON body: %w", err)
	}

	if len(payload.TemplateJSON) == 0 {
		return nil, fmt.Errorf("templateJson is required")
	}

	var imageReader io.Reader
	imageMime := payload.ImageMimeType
	if payload.ImageBase64 != "" {
		imageBytes, err := base64.StdEncoding.DecodeString(payload.ImageBase64)
		if err != nil {
			return nil, fmt.Errorf("invalid imageBase64: %w", err)
		}
		imageReader = bytes.NewReader(imageBytes)
		if imageMime == "" {
			imageMime = "image/png"
		}
	}

	return &parsedUploadTemplate{
		templateJSON:  payload.TemplateJSON,
		metadata:      payload.Metadata,
		variablesJSON: payload.VariablesJSON,
		imageReader:   imageReader,
		imageMime:     imageMime,
	}, nil
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
