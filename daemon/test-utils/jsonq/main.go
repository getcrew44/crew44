package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type pathSegment struct {
	key     string
	indexes []int
}

func main() {
	var (
		filePath     string
		pathExpr     string
		lineContains string
		rawValue     string
		lengthOnly   bool
		unixTime     bool
	)

	flag.StringVar(&filePath, "file", "", "read JSON from file instead of stdin")
	flag.StringVar(&pathExpr, "path", "", "dot path with optional [index] segments")
	flag.StringVar(&lineContains, "line-contains", "", "when set, read the first JSONL line containing this substring")
	flag.StringVar(&rawValue, "value", "", "use a raw string value instead of reading JSON input")
	flag.BoolVar(&lengthOnly, "len", false, "print length of selected array, object, or string")
	flag.BoolVar(&unixTime, "unix-time", false, "interpret the selected value as RFC3339/RFC3339Nano and print unix seconds")
	flag.Parse()

	var (
		value any
		err   error
	)
	if rawValue != "" {
		value = rawValue
	} else {
		data, err := readInput(filePath, lineContains)
		if err != nil {
			fail(err)
		}
		if err := json.Unmarshal(data, &value); err != nil {
			fail(err)
		}
	}

	if pathExpr != "" {
		value, err = resolvePath(value, pathExpr)
		if err != nil {
			fail(err)
		}
	}

	switch {
	case lengthOnly:
		printLength(value)
	case unixTime:
		printUnixTime(value)
	default:
		printValue(value)
	}
}

func readInput(filePath, lineContains string) ([]byte, error) {
	var data []byte
	var err error
	if filePath == "" {
		data, err = ioReadAll(os.Stdin)
	} else {
		data, err = os.ReadFile(filePath)
	}
	if err != nil {
		return nil, err
	}
	if lineContains == "" {
		return data, nil
	}

	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if strings.Contains(line, lineContains) {
			return []byte(line), nil
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return nil, fmt.Errorf("no json line contains %q", lineContains)
}

func resolvePath(value any, expr string) (any, error) {
	segments, err := parsePath(expr)
	if err != nil {
		return nil, err
	}
	current := value
	for _, segment := range segments {
		if segment.key != "" {
			obj, ok := current.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("path %q expected object before key %q", expr, segment.key)
			}
			next, ok := obj[segment.key]
			if !ok {
				return nil, fmt.Errorf("path %q missing key %q", expr, segment.key)
			}
			current = next
		}
		for _, index := range segment.indexes {
			items, ok := current.([]any)
			if !ok {
				return nil, fmt.Errorf("path %q expected array before index %d", expr, index)
			}
			if index < 0 || index >= len(items) {
				return nil, fmt.Errorf("path %q index %d out of range", expr, index)
			}
			current = items[index]
		}
	}
	return current, nil
}

func parsePath(expr string) ([]pathSegment, error) {
	rawSegments := strings.Split(expr, ".")
	segments := make([]pathSegment, 0, len(rawSegments))
	for _, raw := range rawSegments {
		if raw == "" {
			return nil, errors.New("empty path segment")
		}
		segment := pathSegment{}
		for len(raw) > 0 {
			open := strings.IndexByte(raw, '[')
			if open < 0 {
				if segment.key == "" {
					segment.key = raw
				} else {
					return nil, fmt.Errorf("invalid path segment %q", raw)
				}
				raw = ""
				continue
			}
			if open > 0 && segment.key == "" {
				segment.key = raw[:open]
			}
			close := strings.IndexByte(raw[open:], ']')
			if close < 0 {
				return nil, fmt.Errorf("unclosed index in %q", expr)
			}
			close += open
			index, err := strconv.Atoi(raw[open+1 : close])
			if err != nil {
				return nil, fmt.Errorf("invalid index in %q: %w", expr, err)
			}
			segment.indexes = append(segment.indexes, index)
			raw = raw[close+1:]
		}
		segments = append(segments, segment)
	}
	return segments, nil
}

func printLength(value any) {
	switch item := value.(type) {
	case []any:
		fmt.Println(len(item))
	case map[string]any:
		fmt.Println(len(item))
	case string:
		fmt.Println(len(item))
	default:
		fail(fmt.Errorf("cannot take length of %T", value))
	}
}

func printUnixTime(value any) {
	raw, ok := value.(string)
	if !ok {
		fail(fmt.Errorf("unix-time expects string, got %T", value))
	}
	ts, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil {
		ts, err = time.Parse(time.RFC3339, raw)
		if err != nil {
			fail(err)
		}
	}
	fmt.Println(ts.Unix())
}

func printValue(value any) {
	switch item := value.(type) {
	case nil:
		fmt.Println("null")
	case string:
		fmt.Println(item)
	case bool:
		fmt.Println(strconv.FormatBool(item))
	case float64:
		if item == float64(int64(item)) {
			fmt.Println(strconv.FormatInt(int64(item), 10))
			return
		}
		fmt.Println(strconv.FormatFloat(item, 'f', -1, 64))
	default:
		data, err := json.Marshal(item)
		if err != nil {
			fail(err)
		}
		fmt.Println(string(data))
	}
}

func ioReadAll(file *os.File) ([]byte, error) {
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(file); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
