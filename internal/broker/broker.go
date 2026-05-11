package broker

import "sync"

type Kind string

const (
	KindEvent Kind = "event"
	KindDone  Kind = "done"
	KindError Kind = "error"
)

type Notification[T any] struct {
	Kind  Kind
	Value T
	Error string
}

type Broker[T any] struct {
	mu          sync.Mutex
	subscribers map[string]map[chan Notification[T]]struct{}
}

func New[T any]() *Broker[T] {
	return &Broker[T]{
		subscribers: make(map[string]map[chan Notification[T]]struct{}),
	}
}

func (b *Broker[T]) Subscribe(scope string) (<-chan Notification[T], func()) {
	b.mu.Lock()
	defer b.mu.Unlock()

	ch := make(chan Notification[T], 16)
	if b.subscribers[scope] == nil {
		b.subscribers[scope] = make(map[chan Notification[T]]struct{})
	}
	b.subscribers[scope][ch] = struct{}{}

	cancel := func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		if subs, ok := b.subscribers[scope]; ok {
			delete(subs, ch)
			if len(subs) == 0 {
				delete(b.subscribers, scope)
			}
		}
		close(ch)
	}
	return ch, cancel
}

func (b *Broker[T]) Publish(scope string, notification Notification[T]) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subscribers[scope] {
		select {
		case ch <- notification:
		default:
		}
	}
}
