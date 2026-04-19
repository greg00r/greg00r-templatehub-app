package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/grafana/authlib/authz"
	"github.com/greg00r/greg00r-templatehub-app/pkg/plugin/storage"
)

// Ensure Plugin implements the required interfaces at compile time.
var (
	_ backend.CallResourceHandler   = (*Plugin)(nil)
	_ instancemgmt.InstanceDisposer = (*Plugin)(nil)
)

// Plugin is the App Plugin instance. One instance is created per Grafana org
// (or per plugin configuration, depending on Grafana version).
type Plugin struct {
	storage          storage.Storage
	logger           log.Logger
	httpClient       *http.Client
	permissionLookup userPermissionLookup
	authzMu          sync.Mutex
	authzClient      authz.EnforcementClient
	saToken          string
}

// NewPlugin is the factory function called by app.Manage on startup.
func NewPlugin(_ context.Context, settings backend.AppInstanceSettings) (instancemgmt.Instance, error) {
	logger := log.DefaultLogger.With("plugin", "greg00r-templatehub-app")

	pluginSettings, secureSettings, err := parseSettings(settings)
	if err != nil {
		return nil, fmt.Errorf("parsing plugin settings: %w", err)
	}

	var store storage.Storage

	switch pluginSettings.StorageBackend {
	case "external":
		if pluginSettings.ExternalURL == "" {
			return nil, fmt.Errorf("externalUrl is required when storageBackend=external")
		}
		token := secureSettings.ExternalAuthToken
		if token == "" {
			token = secureSettings.ExternalAuthPassword
		}
		store = storage.NewExternalStorage(
			pluginSettings.ExternalURL,
			pluginSettings.ExternalAuthType,
			token,
			pluginSettings.ExternalAuthUser,
		)
		logger.Info("Using external storage", "url", pluginSettings.ExternalURL)

	default: // "local" or empty
		localPath := resolveLocalStoragePath(pluginSettings.LocalPath, logger)
		store, err = storage.NewLocalStorage(localPath)
		if err != nil {
			return nil, fmt.Errorf("initializing local storage: %w", err)
		}
		logger.Info("Using local storage", "path", localPath)
	}

	return &Plugin{
		storage:    store,
		logger:     logger,
		httpClient: &http.Client{Timeout: 5 * time.Second},
	}, nil
}

func resolveLocalStoragePath(configuredPath string, logger log.Logger) string {
	if configuredPath != "" {
		return configuredPath
	}

	if _, err := os.Stat(DefaultLocalPath); err == nil {
		return DefaultLocalPath
	}

	if _, err := os.Stat(LegacyLocalPath); err == nil {
		if migrateErr := os.MkdirAll(filepath.Dir(DefaultLocalPath), 0755); migrateErr != nil {
			logger.Warn("Could not prepare Template Hub storage directory, using legacy path", "error", migrateErr)
			return LegacyLocalPath
		}

		if migrateErr := os.Rename(LegacyLocalPath, DefaultLocalPath); migrateErr != nil {
			logger.Warn("Could not migrate legacy marketplace storage to Template Hub path, using legacy path", "error", migrateErr)
			return LegacyLocalPath
		}

		logger.Info("Migrated legacy marketplace storage to Template Hub path", "from", LegacyLocalPath, "to", DefaultLocalPath)
		return DefaultLocalPath
	} else if !os.IsNotExist(err) {
		logger.Warn("Could not inspect legacy marketplace storage path", "error", err)
	}

	return DefaultLocalPath
}

// CallResource handles all HTTP resource calls routed through /api/plugins/<id>/resources/*.
func (p *Plugin) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	// Convert the SDK request to a standard http.Request for use with our handler.
	httpReq, err := toHTTPRequest(ctx, req)
	if err != nil {
		return err
	}

	rw := &responseWriterBuffer{}
	p.handleResources(rw, httpReq, req.PluginContext)

	return sender.Send(&backend.CallResourceResponse{
		Status:  rw.status,
		Headers: rw.header,
		Body:    rw.body.Bytes(),
	})
}

// Dispose is called when the plugin instance is being shut down.
func (p *Plugin) Dispose() {}

// ── Settings parsing ─────────────────────────────────────────────────────────

func parseSettings(settings backend.AppInstanceSettings) (PluginSettings, PluginSecureSettings, error) {
	var ps PluginSettings
	var ss PluginSecureSettings

	if len(settings.JSONData) > 0 {
		if err := json.Unmarshal(settings.JSONData, &ps); err != nil {
			return ps, ss, fmt.Errorf("unmarshalling jsonData: %w", err)
		}
	}

	// Secure settings are passed as decrypted strings by the SDK.
	if v, ok := settings.DecryptedSecureJSONData["externalAuthToken"]; ok {
		ss.ExternalAuthToken = v
	}
	if v, ok := settings.DecryptedSecureJSONData["externalAuthPassword"]; ok {
		ss.ExternalAuthPassword = v
	}

	return ps, ss, nil
}

// ── HTTP adapter ─────────────────────────────────────────────────────────────

// toHTTPRequest converts a backend.CallResourceRequest to a standard *http.Request.
func toHTTPRequest(ctx context.Context, req *backend.CallResourceRequest) (*http.Request, error) {
	httpReq, err := http.NewRequestWithContext(ctx, req.Method, "/"+req.Path, bytes.NewReader(req.Body))
	if err != nil {
		return nil, fmt.Errorf("building http.Request: %w", err)
	}
	httpReq.ContentLength = int64(len(req.Body))
	for k, vals := range req.Headers {
		for _, v := range vals {
			httpReq.Header.Add(k, v)
		}
	}
	// Attach URL query params from the original URL if present.
	if req.URL != "" {
		// req.URL may carry query params – parse and append them.
		if idx := indexOf(req.URL, '?'); idx >= 0 {
			httpReq.URL.RawQuery = req.URL[idx+1:]
		}
	}
	return httpReq, nil
}

func indexOf(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
}

// responseWriterBuffer is a minimal http.ResponseWriter that buffers the response.
type responseWriterBuffer struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (rw *responseWriterBuffer) Header() http.Header {
	if rw.header == nil {
		rw.header = make(http.Header)
	}
	return rw.header
}

func (rw *responseWriterBuffer) Write(b []byte) (int, error) {
	if rw.status == 0 {
		rw.status = http.StatusOK
	}
	return rw.body.Write(b)
}

func (rw *responseWriterBuffer) WriteHeader(status int) {
	rw.status = status
}

// Satisfy io.Writer for completeness (used by http.Error internally).
var _ io.Writer = (*responseWriterBuffer)(nil)
