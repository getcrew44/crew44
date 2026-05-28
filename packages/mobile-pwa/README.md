# Crew44 Mobile PWA

POC mobile companion for Crew44. This package is a static Vite app intended for
`https://mobileapp.crew44.io`.

## Development

```bash
npm run mobile-pwa:start
```

## Build

```bash
npm run mobile-pwa:build
```

The static output is written to:

```text
packages/mobile-pwa/dist/
```

## Nginx Static Site

Point `mobileapp.crew44.io` at the build output directory and route SPA paths to
`index.html`:

```nginx
server {
  listen 443 ssl http2;
  server_name mobileapp.crew44.io;

  root /var/www/crew44-mobile-pwa;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location = /sw.js {
    add_header Cache-Control "no-cache";
    try_files $uri =404;
  }

  location = /manifest.webmanifest {
    add_header Cache-Control "public, max-age=3600";
    try_files $uri =404;
  }

  location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
  }

  location /icons/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
  }
}
```
