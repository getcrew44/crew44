package cli

import "strconv"

func formatInt(value int64) string {
	return strconv.FormatInt(value, 10)
}
