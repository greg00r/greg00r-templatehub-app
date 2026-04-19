package main

import (
	"os"

	"github.com/grafana/grafana-plugin-sdk-go/backend/app"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/greg00r/greg00r-templatehub-app/pkg/plugin"
)

func main() {
	// app.Manage is the correct entry point for App Plugins (not backend.Manage).
	// It wires up the instance manager and routes CallResource to plugin instances
	// that implement backend.CallResourceHandler.
	if err := app.Manage("greg00r-templatehub-app", plugin.NewPlugin, app.ManageOpts{}); err != nil {
		log.DefaultLogger.Error("Error starting plugin", "error", err.Error())
		os.Exit(1)
	}
}
