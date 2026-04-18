package storage

import (
	"bytes"
	"testing"
)

func TestLocalStorageSaveAndReadTemplate(t *testing.T) {
	rootDir := t.TempDir()

	store, err := NewLocalStorage(rootDir)
	if err != nil {
		t.Fatalf("NewLocalStorage returned error: %v", err)
	}

	templateJSON := []byte(`{"title":"Demo Dashboard"}`)
	metadataJSON := []byte(`{"id":"demo","title":"Demo Dashboard","shortDescription":"Short","longDescription":"Long","tags":["demo"],"requiredDatasources":[{"type":"prometheus","name":"Prometheus"}],"author":"QA","version":"1.0.0","createdAt":"2026-04-18","updatedAt":"2026-04-18"}`)
	variablesJSON := []byte(`{"variables":[{"name":"cluster","label":"Cluster","type":"textbox"}]}`)
	imageBytes := []byte("image-bytes")

	if err := store.SaveTemplate(
		"demo",
		templateJSON,
		metadataJSON,
		variablesJSON,
		bytes.NewReader(imageBytes),
		"image/png",
	); err != nil {
		t.Fatalf("SaveTemplate returned error: %v", err)
	}

	listedTemplates, err := store.ListTemplates()
	if err != nil {
		t.Fatalf("ListTemplates returned error: %v", err)
	}
	if len(listedTemplates) != 1 {
		t.Fatalf("ListTemplates returned %d templates, want 1", len(listedTemplates))
	}

	gotTemplateJSON, err := store.GetTemplate("demo")
	if err != nil {
		t.Fatalf("GetTemplate returned error: %v", err)
	}
	if string(gotTemplateJSON) != string(templateJSON) {
		t.Fatalf("GetTemplate returned %q, want %q", string(gotTemplateJSON), string(templateJSON))
	}

	gotMetadataJSON, err := store.GetMetadata("demo")
	if err != nil {
		t.Fatalf("GetMetadata returned error: %v", err)
	}
	if string(gotMetadataJSON) != string(metadataJSON) {
		t.Fatalf("GetMetadata returned %q, want %q", string(gotMetadataJSON), string(metadataJSON))
	}

	gotVariablesJSON, err := store.GetVariables("demo")
	if err != nil {
		t.Fatalf("GetVariables returned error: %v", err)
	}
	if string(gotVariablesJSON) != string(variablesJSON) {
		t.Fatalf("GetVariables returned %q, want %q", string(gotVariablesJSON), string(variablesJSON))
	}

	gotImageBytes, gotImageMime, err := store.GetImage("demo")
	if err != nil {
		t.Fatalf("GetImage returned error: %v", err)
	}
	if gotImageMime != "image/png" {
		t.Fatalf("GetImage returned mime type %q, want %q", gotImageMime, "image/png")
	}
	if string(gotImageBytes) != string(imageBytes) {
		t.Fatalf("GetImage returned %q, want %q", string(gotImageBytes), string(imageBytes))
	}
}
