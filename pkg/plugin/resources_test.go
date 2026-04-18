package plugin

import "testing"

func TestNormalizeResourcePath(t *testing.T) {
	testCases := []struct {
		name string
		path string
		want string
	}{
		{
			name: "full grafana resource path",
			path: "/api/plugins/gregoor-private-marketplace-app/resources/templates/demo",
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
