package cli

import (
	"reflect"
	"testing"
)

func TestSplitCSV(t *testing.T) {
	got := splitCSV(" skill-a,skill-b , , skill-c ")
	want := []string{"skill-a", "skill-b", "skill-c"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("splitCSV mismatch: got %#v want %#v", got, want)
	}
}
