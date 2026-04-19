package plugin

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/greg00r/greg00r-templatehub-app/pkg/plugin/storage"
)

func TestNormalizeResourcePath(t *testing.T) {
	testCases := []struct {
		name string
		path string
		want string
	}{
		{
			name: "full grafana resource path",
			path: "/api/plugins/greg00r-templatehub-app/resources/templates/demo",
			want: "templates/demo",
		},
		{
			name: "relative resources path",
			path: "resources/templates/demo/image",
			want: "templates/demo/image",
		},
		{
			name: "plain path",
			path: "/templates/demo/variables",
			want: "templates/demo/variables",
		},
		{
			name: "empty path",
			path: " / ",
			want: "",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got := normalizeResourcePath(tc.path)
			if got != tc.want {
				t.Fatalf("normalizeResourcePath(%q) = %q, want %q", tc.path, got, tc.want)
			}
		})
	}
}

func TestSlugify(t *testing.T) {
	got := slugify("Kubernetes Cluster Overview")
	want := "kubernetes-cluster-overview"
	if got != want {
		t.Fatalf("slugify returned %q, want %q", got, want)
	}
}

func TestHandleUploadTemplateRejectsViewerRole(t *testing.T) {
	plugin := newTestPlugin(t)
	req := httptest.NewRequest(http.MethodPost, "/api/plugins/"+pluginID+"/resources/templates", strings.NewReader(validUploadBody()))
	req.Header.Set("Content-Type", "application/json")
	req.ContentLength = int64(len(validUploadBody()))

	recorder := httptest.NewRecorder()
	plugin.handleUploadTemplate(recorder, req, backend.PluginContext{
		User: &backend.User{Login: "viewer", Role: "Viewer"},
	})

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusForbidden, recorder.Body.String())
	}
}

func TestHandleUploadTemplateCreatesTemplateAndAuditMetadata(t *testing.T) {
	plugin := newTestPlugin(t)
	body := validUploadBody()
	req := httptest.NewRequest(http.MethodPost, "/api/plugins/"+pluginID+"/resources/templates", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.ContentLength = int64(len(body))

	recorder := httptest.NewRecorder()
	plugin.handleUploadTemplate(recorder, req, backend.PluginContext{
		User: &backend.User{Login: "dev.user", Name: "Dev User", Role: "Editor"},
	})

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusCreated, recorder.Body.String())
	}

	storedMetadata, err := plugin.storage.GetMetadata("demo-dashboard-1-0-0", storage.TemplateStatePending)
	if err != nil {
		t.Fatalf("GetMetadata returned error: %v", err)
	}

	var metadata TemplateMetadata
	if err := json.Unmarshal(storedMetadata, &metadata); err != nil {
		t.Fatalf("unmarshal metadata returned error: %v", err)
	}

	if metadata.Author != "Dev User" {
		t.Fatalf("metadata.Author = %q, want %q", metadata.Author, "Dev User")
	}
	if metadata.CreatedBy != "Dev User" {
		t.Fatalf("metadata.CreatedBy = %q, want %q", metadata.CreatedBy, "Dev User")
	}
	if metadata.UpdatedBy != "Dev User" {
		t.Fatalf("metadata.UpdatedBy = %q, want %q", metadata.UpdatedBy, "Dev User")
	}
	if metadata.Version != defaultTemplateVer {
		t.Fatalf("metadata.Version = %q, want %q", metadata.Version, defaultTemplateVer)
	}
	if metadata.Status != TemplateStatusPending {
		t.Fatalf("metadata.Status = %q, want %q", metadata.Status, TemplateStatusPending)
	}
}

func TestHandleUploadTemplateAllowsViewerWithPublishPermission(t *testing.T) {
	plugin := newTestPlugin(t)
	plugin.permissionLookup = func(_ *http.Request) (grafanaPermissionMap, bool, error) {
		return grafanaPermissionMap{
			actionTemplatesPublish: {""},
		}, true, nil
	}

	body := validUploadBody()
	req := httptest.NewRequest(http.MethodPost, "/api/plugins/"+pluginID+"/resources/templates", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.ContentLength = int64(len(body))

	recorder := httptest.NewRecorder()
	plugin.handleUploadTemplate(recorder, req, backend.PluginContext{
		User: &backend.User{Login: "viewer", Role: "Viewer"},
	})

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusCreated, recorder.Body.String())
	}
}

func TestHandleUploadTemplateOverridesSpoofedAuthorWithLoggedInUser(t *testing.T) {
	plugin := newTestPlugin(t)
	body := `{
		"templateJson": {"title":"Demo Dashboard","panels":[]},
		"metadata": {
			"title":"Demo Dashboard",
			"shortDescription":"Short description",
			"author":"Spoofed Author"
		},
		"variablesJson": {
			"variables": [
				{"name":"cluster","label":"Cluster","type":"textbox"}
			]
		}
	}`

	req := httptest.NewRequest(http.MethodPost, "/api/plugins/"+pluginID+"/resources/templates", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.ContentLength = int64(len(body))

	recorder := httptest.NewRecorder()
	plugin.handleUploadTemplate(recorder, req, backend.PluginContext{
		User: &backend.User{Login: "dev.user", Name: "Dev User", Role: "Editor"},
	})

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusCreated, recorder.Body.String())
	}

	storedMetadata, err := plugin.storage.GetMetadata("demo-dashboard-1-0-0", storage.TemplateStatePending)
	if err != nil {
		t.Fatalf("GetMetadata returned error: %v", err)
	}

	var metadata TemplateMetadata
	if err := json.Unmarshal(storedMetadata, &metadata); err != nil {
		t.Fatalf("unmarshal metadata returned error: %v", err)
	}

	if metadata.Author != "Dev User" {
		t.Fatalf("metadata.Author = %q, want %q", metadata.Author, "Dev User")
	}
}

func TestHandleUploadTemplateRejectsDuplicateTemplateIDs(t *testing.T) {
	plugin := newTestPlugin(t)
	upload := func() *httptest.ResponseRecorder {
		body := validUploadBody()
		req := httptest.NewRequest(http.MethodPost, "/api/plugins/"+pluginID+"/resources/templates", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.ContentLength = int64(len(body))

		recorder := httptest.NewRecorder()
		plugin.handleUploadTemplate(recorder, req, backend.PluginContext{
			User: &backend.User{Login: "editor", Role: "Editor"},
		})
		return recorder
	}

	first := upload()
	if first.Code != http.StatusCreated {
		t.Fatalf("first status = %d, want %d; body=%s", first.Code, http.StatusCreated, first.Body.String())
	}

	second := upload()
	if second.Code != http.StatusConflict {
		t.Fatalf("second status = %d, want %d; body=%s", second.Code, http.StatusConflict, second.Body.String())
	}
}

func TestHandleUploadTemplateAllowsSameTitleWithDifferentVersion(t *testing.T) {
	plugin := newTestPlugin(t)

	upload := func(version string) *httptest.ResponseRecorder {
		body := `{
			"templateJson": {"title":"Demo Dashboard","panels":[]},
			"metadata": {"title":"Demo Dashboard","shortDescription":"Short description","version":"` + version + `"},
			"variablesJson": {"variables":[]}
		}`
		req := httptest.NewRequest(http.MethodPost, "/api/plugins/"+pluginID+"/resources/templates", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.ContentLength = int64(len(body))

		recorder := httptest.NewRecorder()
		plugin.handleUploadTemplate(recorder, req, backend.PluginContext{
			User: &backend.User{Login: "editor", Role: "Editor"},
		})
		return recorder
	}

	first := upload("1.0.0")
	if first.Code != http.StatusCreated {
		t.Fatalf("first status = %d, want %d; body=%s", first.Code, http.StatusCreated, first.Body.String())
	}

	second := upload("1.1.0")
	if second.Code != http.StatusCreated {
		t.Fatalf("second status = %d, want %d; body=%s", second.Code, http.StatusCreated, second.Body.String())
	}
}

func TestHandleUploadTemplateRejectsDuplicateVariableNames(t *testing.T) {
	plugin := newTestPlugin(t)
	body := `{
		"templateJson": {"title":"Demo Dashboard","panels":[]},
		"metadata": {"title":"Demo Dashboard","shortDescription":"Short description"},
		"variablesJson": {
			"variables": [
				{"name":"cluster","label":"Cluster","type":"textbox"},
				{"name":"cluster","label":"Cluster copy","type":"textbox"}
			]
		}
	}`

	req := httptest.NewRequest(http.MethodPost, "/api/plugins/"+pluginID+"/resources/templates", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.ContentLength = int64(len(body))

	recorder := httptest.NewRecorder()
	plugin.handleUploadTemplate(recorder, req, backend.PluginContext{
		User: &backend.User{Login: "editor", Role: "Editor"},
	})

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusBadRequest, recorder.Body.String())
	}
}

func TestHandleDeleteTemplateRequiresAdminRole(t *testing.T) {
	plugin := newTestPlugin(t)
	recorder := httptest.NewRecorder()

	req := httptest.NewRequest(http.MethodDelete, "/api/plugins/"+pluginID+"/resources/templates/demo-dashboard", nil)
	plugin.handleDeleteTemplate(recorder, req, "demo-dashboard", backend.PluginContext{
		User: &backend.User{Login: "editor", Role: "Editor"},
	})

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusForbidden, recorder.Body.String())
	}
}

func TestHandleListTemplatesHidesPendingTemplatesFromViewer(t *testing.T) {
	plugin := newTestPlugin(t)
	body := validUploadBody()
	req := httptest.NewRequest(http.MethodPost, "/api/plugins/"+pluginID+"/resources/templates", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.ContentLength = int64(len(body))

	recorder := httptest.NewRecorder()
	plugin.handleUploadTemplate(recorder, req, backend.PluginContext{
		User: &backend.User{Login: "editor", Role: "Editor"},
	})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, want %d; body=%s", recorder.Code, http.StatusCreated, recorder.Body.String())
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/plugins/"+pluginID+"/resources/templates?status=pending", nil)
	listRecorder := httptest.NewRecorder()
	plugin.handleListTemplates(listRecorder, listReq, backend.PluginContext{
		User: &backend.User{Login: "viewer", Role: "Viewer"},
	})

	if listRecorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d; body=%s", listRecorder.Code, http.StatusForbidden, listRecorder.Body.String())
	}
}

func TestHandleListTemplatesAllowsPendingTemplatesWithReviewPermission(t *testing.T) {
	plugin := newTestPlugin(t)
	uploadBody := validUploadBody()
	uploadReq := httptest.NewRequest(http.MethodPost, "/api/plugins/"+pluginID+"/resources/templates", strings.NewReader(uploadBody))
	uploadReq.Header.Set("Content-Type", "application/json")
	uploadReq.ContentLength = int64(len(uploadBody))

	uploadRecorder := httptest.NewRecorder()
	plugin.handleUploadTemplate(uploadRecorder, uploadReq, backend.PluginContext{
		User: &backend.User{Login: "editor", Role: "Editor"},
	})
	if uploadRecorder.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, want %d; body=%s", uploadRecorder.Code, http.StatusCreated, uploadRecorder.Body.String())
	}

	plugin.permissionLookup = func(_ *http.Request) (grafanaPermissionMap, bool, error) {
		return grafanaPermissionMap{
			actionTemplatesReview: {""},
		}, true, nil
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/plugins/"+pluginID+"/resources/templates?status=pending", nil)
	listRecorder := httptest.NewRecorder()
	plugin.handleListTemplates(listRecorder, listReq, backend.PluginContext{
		User: &backend.User{Login: "viewer", Role: "Viewer"},
	})

	if listRecorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", listRecorder.Code, http.StatusOK, listRecorder.Body.String())
	}
}

func TestHandleGetAccessFallsBackToBasicRoleOnOSS(t *testing.T) {
	plugin := newTestPlugin(t)
	plugin.permissionLookup = func(_ *http.Request) (grafanaPermissionMap, bool, error) {
		return nil, false, nil
	}

	req := httptest.NewRequest(http.MethodGet, "/api/plugins/"+pluginID+"/resources/access", nil)
	recorder := httptest.NewRecorder()
	plugin.handleGetAccess(recorder, req, backend.PluginContext{
		User: &backend.User{Login: "editor", Role: "Editor"},
	})

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}

	var access MarketplaceAccess
	if err := json.Unmarshal(recorder.Body.Bytes(), &access); err != nil {
		t.Fatalf("unmarshal access returned error: %v", err)
	}

	if !access.Publish {
		t.Fatalf("expected publish access for editor fallback, got %#v", access)
	}
	if access.Review {
		t.Fatalf("expected review access to be false for editor fallback, got %#v", access)
	}
	if access.Source != "basic-role-fallback" {
		t.Fatalf("access.Source = %q, want %q", access.Source, "basic-role-fallback")
	}
}

func TestHandleGetAccessHonorsPluginRBACActions(t *testing.T) {
	plugin := newTestPlugin(t)
	plugin.permissionLookup = func(_ *http.Request) (grafanaPermissionMap, bool, error) {
		return grafanaPermissionMap{
			actionTemplatesPublish: {""},
			actionTemplatesReview:  {""},
			actionTemplatesApprove: {""},
		}, true, nil
	}

	req := httptest.NewRequest(http.MethodGet, "/api/plugins/"+pluginID+"/resources/access", nil)
	recorder := httptest.NewRecorder()
	plugin.handleGetAccess(recorder, req, backend.PluginContext{
		User: &backend.User{Login: "viewer", Role: "Viewer"},
	})

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusOK, recorder.Body.String())
	}

	var access MarketplaceAccess
	if err := json.Unmarshal(recorder.Body.Bytes(), &access); err != nil {
		t.Fatalf("unmarshal access returned error: %v", err)
	}

	if !access.Publish || !access.Review || !access.Approve {
		t.Fatalf("expected RBAC actions to elevate access, got %#v", access)
	}
	if access.Delete {
		t.Fatalf("expected delete to remain false without matching action, got %#v", access)
	}
	if !access.RBACAvailable {
		t.Fatalf("expected RBACAvailable to be true, got %#v", access)
	}
}

func TestHandleApproveTemplateMovesTemplateToApprovedQueue(t *testing.T) {
	plugin := newTestPlugin(t)
	body := validUploadBody()
	uploadReq := httptest.NewRequest(http.MethodPost, "/api/plugins/"+pluginID+"/resources/templates", strings.NewReader(body))
	uploadReq.Header.Set("Content-Type", "application/json")
	uploadReq.ContentLength = int64(len(body))

	uploadRecorder := httptest.NewRecorder()
	plugin.handleUploadTemplate(uploadRecorder, uploadReq, backend.PluginContext{
		User: &backend.User{Login: "editor", Role: "Editor"},
	})
	if uploadRecorder.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, want %d; body=%s", uploadRecorder.Code, http.StatusCreated, uploadRecorder.Body.String())
	}

	approveRecorder := httptest.NewRecorder()
	plugin.handleApproveTemplate(approveRecorder, httptest.NewRequest(http.MethodPost, "/approve", nil), "demo-dashboard-1-0-0", backend.PluginContext{
		User: &backend.User{Login: "admin", Name: "Admin User", Role: "Admin"},
	})
	if approveRecorder.Code != http.StatusOK {
		t.Fatalf("approve status = %d, want %d; body=%s", approveRecorder.Code, http.StatusOK, approveRecorder.Body.String())
	}

	if _, err := plugin.storage.GetMetadata("demo-dashboard-1-0-0", storage.TemplateStatePending); !errors.Is(err, storage.ErrTemplateNotFound) {
		t.Fatalf("pending metadata error = %v, want ErrTemplateNotFound", err)
	}

	approvedMetadataBytes, err := plugin.storage.GetMetadata("demo-dashboard-1-0-0", storage.TemplateStateApproved)
	if err != nil {
		t.Fatalf("approved GetMetadata returned error: %v", err)
	}

	var approvedMetadata TemplateMetadata
	if err := json.Unmarshal(approvedMetadataBytes, &approvedMetadata); err != nil {
		t.Fatalf("unmarshal approved metadata returned error: %v", err)
	}

	if approvedMetadata.Status != TemplateStatusApproved {
		t.Fatalf("approved metadata.Status = %q, want %q", approvedMetadata.Status, TemplateStatusApproved)
	}
	if approvedMetadata.ApprovedBy != "Admin User" {
		t.Fatalf("approved metadata.ApprovedBy = %q, want %q", approvedMetadata.ApprovedBy, "Admin User")
	}
}

func newTestPlugin(t *testing.T) *Plugin {
	t.Helper()

	store, err := storage.NewLocalStorage(t.TempDir())
	if err != nil {
		t.Fatalf("NewLocalStorage returned error: %v", err)
	}

	return &Plugin{
		storage:    store,
		logger:     log.NewNullLogger(),
		httpClient: http.DefaultClient,
	}
}

func validUploadBody() string {
	return `{
		"templateJson": {"title":"Demo Dashboard","panels":[]},
		"metadata": {"title":"Demo Dashboard","shortDescription":"Short description"},
		"variablesJson": {
			"variables": [
				{"name":"cluster","label":"Cluster","type":"textbox"}
			]
		}
	}`
}
