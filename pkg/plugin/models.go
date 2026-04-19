package plugin

type TemplateStatus string

const (
	TemplateStatusApproved TemplateStatus = "approved"
	TemplateStatusPending  TemplateStatus = "pending"
)

// TemplateMetadata holds descriptive information about a dashboard template.
type TemplateMetadata struct {
	ID                  string               `json:"id"`
	Title               string               `json:"title"`
	ShortDescription    string               `json:"shortDescription"`
	LongDescription     string               `json:"longDescription"`
	Tags                []string             `json:"tags"`
	Folder              string               `json:"folder,omitempty"`
	RequiredDatasources []RequiredDatasource `json:"requiredDatasources"`
	Author              string               `json:"author"`
	Version             string               `json:"version"`
	CreatedAt           string               `json:"createdAt"`
	UpdatedAt           string               `json:"updatedAt"`
	CreatedBy           string               `json:"createdBy,omitempty"`
	UpdatedBy           string               `json:"updatedBy,omitempty"`
	Status              TemplateStatus       `json:"status,omitempty"`
	ApprovedAt          string               `json:"approvedAt,omitempty"`
	ApprovedBy          string               `json:"approvedBy,omitempty"`
}

// RequiredDatasource describes a datasource type required by a template.
type RequiredDatasource struct {
	Type string `json:"type"`
	Name string `json:"name"`
}

// TemplateVariable describes a single variable shown during import.
type TemplateVariable struct {
	Name           string   `json:"name"`
	Label          string   `json:"label"`
	Type           string   `json:"type"`
	Description    string   `json:"description,omitempty"`
	Default        string   `json:"default,omitempty"`
	Required       bool     `json:"required,omitempty"`
	Options        []string `json:"options,omitempty"`
	Datasource     string   `json:"datasource,omitempty"`
	Query          string   `json:"query,omitempty"`
	Multi          bool     `json:"multi,omitempty"`
	IncludeAll     bool     `json:"includeAll,omitempty"`
	DatasourceType string   `json:"datasourceType,omitempty"`
}

// TemplateVariables is the container stored in variables.json.
type TemplateVariables struct {
	Variables []TemplateVariable `json:"variables"`
}

// Template is the list-view representation returned by GET /resources/templates.
type Template struct {
	Metadata TemplateMetadata `json:"metadata"`
	ImageURL string           `json:"imageUrl,omitempty"`
}

// PluginSettings holds the JSON data configured in the plugin's config page.
type PluginSettings struct {
	StorageBackend   string `json:"storageBackend"` // "local" | "external"
	LocalPath        string `json:"localPath"`
	ExternalURL      string `json:"externalUrl"`
	ExternalAuthType string `json:"externalAuthType"` // "none" | "bearer" | "basic"
	ExternalAuthUser string `json:"externalAuthUsername"`
}

// PluginSecureSettings holds secrets (never returned to browser).
type PluginSecureSettings struct {
	ExternalAuthToken    string `json:"externalAuthToken"`
	ExternalAuthPassword string `json:"externalAuthPassword"`
}

const (
	DefaultLocalPath = "/var/lib/grafana/plugins-data/greg00r-templatehub-app/templates"
	LegacyLocalPath  = "/var/lib/grafana/plugins-data/gregoor-private-marketplace-app/templates"
)
