package storage

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"time"
)

// ExternalStorage implements Storage by proxying requests to an external HTTP API.
// The external API is expected to expose the same resource paths as the plugin backend.
type ExternalStorage struct {
	baseURL  string
	authType string // "none" | "bearer" | "basic"
	token    string // bearer token or basic password
	username string // basic auth username
	client   *http.Client
}

// NewExternalStorage creates an ExternalStorage pointing at baseURL.
func NewExternalStorage(baseURL, authType, token, username string) *ExternalStorage {
	return &ExternalStorage{
		baseURL:  baseURL,
		authType: authType,
		token:    token,
		username: username,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (s *ExternalStorage) addAuth(req *http.Request) {
	switch s.authType {
	case "bearer":
		req.Header.Set("Authorization", "Bearer "+s.token)
	case "basic":
		creds := base64.StdEncoding.EncodeToString([]byte(s.username + ":" + s.token))
		req.Header.Set("Authorization", "Basic "+creds)
	}
}

func (s *ExternalStorage) get(path string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, s.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	s.addAuth(req)
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("not found: %s", path)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("upstream returned %d for %s", resp.StatusCode, path)
	}
	return io.ReadAll(resp.Body)
}

// ListTemplates calls GET /templates on the external API and returns each metadata blob.
func (s *ExternalStorage) ListTemplates() ([][]byte, error) {
	data, err := s.get("/templates")
	if err != nil {
		return nil, err
	}

	var items []json.RawMessage
	if err := json.Unmarshal(data, &items); err == nil {
		results := make([][]byte, 0, len(items))
		for _, item := range items {
			results = append(results, item)
		}
		return results, nil
	}

	return [][]byte{data}, nil
}

func (s *ExternalStorage) GetMetadata(id string) ([]byte, error) {
	return s.get("/templates/" + id)
}

func (s *ExternalStorage) GetTemplate(id string) ([]byte, error) {
	return s.get("/templates/" + id + "/template")
}

func (s *ExternalStorage) GetVariables(id string) ([]byte, error) {
	return s.get("/templates/" + id + "/variables")
}

func (s *ExternalStorage) GetImage(id string) ([]byte, string, error) {
	req, err := http.NewRequest(http.MethodGet, s.baseURL+"/templates/"+id+"/image", nil)
	if err != nil {
		return nil, "", err
	}
	s.addAuth(req)
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, "", fmt.Errorf("upstream returned %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}
	return data, resp.Header.Get("Content-Type"), nil
}

func (s *ExternalStorage) SaveTemplate(
	id string,
	templateJSON, metadataJSON, variablesJSON []byte,
	image io.Reader,
	imageMime string,
) error {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)

	addField := func(name string, data []byte) error {
		fw, err := w.CreateFormField(name)
		if err != nil {
			return err
		}
		_, err = fw.Write(data)
		return err
	}

	if err := addField("templateJson", templateJSON); err != nil {
		return err
	}
	if err := addField("metadata", metadataJSON); err != nil {
		return err
	}
	if err := addField("variablesJson", variablesJSON); err != nil {
		return err
	}

	if image != nil {
		fw, err := w.CreateFormFile("image", "image.png")
		if err != nil {
			return err
		}
		if _, err = io.Copy(fw, image); err != nil {
			return err
		}
	}

	w.Close()

	req, err := http.NewRequest(http.MethodPost, s.baseURL+"/templates", &body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	s.addAuth(req)

	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		msg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("upstream returned %d: %s", resp.StatusCode, string(msg))
	}
	return nil
}

func (s *ExternalStorage) DeleteTemplate(id string) error {
	req, err := http.NewRequest(http.MethodDelete, s.baseURL+"/templates/"+id, nil)
	if err != nil {
		return err
	}
	s.addAuth(req)
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("upstream returned %d", resp.StatusCode)
	}
	return nil
}

func (s *ExternalStorage) Ping() error {
	req, err := http.NewRequest(http.MethodGet, s.baseURL+"/health", nil)
	if err != nil {
		return err
	}
	s.addAuth(req)
	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("external backend unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("external backend returned %d", resp.StatusCode)
	}
	return nil
}
