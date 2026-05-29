package importer

import (
	"bytes"
	"text/template"
)

// renderInlineTemplate executes a small text/template against data and
// returns the rendered string. Errors are surfaced as panics because
// the templates ship with the binary and a runtime parse failure
// indicates a binary build problem, not user input.
func renderInlineTemplate(tmpl string, data any) string {
	t, err := template.New("inline").Parse(tmpl)
	if err != nil {
		panic("importer: parse template: " + err.Error())
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		panic("importer: execute template: " + err.Error())
	}
	return buf.String()
}
