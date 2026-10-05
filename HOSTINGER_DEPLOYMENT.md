# Klyia FreshERP — Hostinger Production Deployment Guide

This guide provides step-by-step instructions to deploy **Klyia FreshERP** onto Hostinger web hosting environments (Hostinger Cloud Hosting, cPanel/hPanel Node.js Application Manager, or Hostinger VPS).

---

## Architecture Overview

* **Frontend**: React 19 SPA built with Vite and Tailwind CSS.
* **Backend**: Express.js server running in Node.js (bundled to `dist/server.cjs`).
* **Database**: Embedded SQLite engine (`production/fresherp.db` and JSON fallback `data/fresh_erp_db.json`), ensuring zero-dependency, self-contained persistence without requiring an external database server.
* **Static / Media Storage**: Multi-format image uploads stored locally in `production/uploads` or `uploads/` and served via `/uploads/*`.
* **SPA Routing**: Automatic rewrite fallback via `.htaccess` (Apache/LiteSpeed) and Express wildcard route (`app.get('*')`).

---

## Pre-requisites on Hostinger

* **Node.js**: Version 18.x, 20.x, or 22.x LTS.
* **NPM**: Version 9.x or higher.
* Domain or subdomain configured on Hostinger (e.g. `erp.yourdomain.com`).

---

## Deployment Option 1: Hostinger Cloud / cPanel "Setup Node.js App" (Recommended)

Hostinger provides an integrated Node.js Manager (Phusion Passenger / LiteSpeed Node runner):

1. **Upload Files**:
   * Upload all project files to your domain directory (e.g., `/home/u123456789/domains/erp.yourdomain.com/public_html` or a dedicated app directory).
   * Ensure `data/` and `uploads/` directories exist and are writable (`chmod 755 data uploads`).

2. **Configure Node.js Application in hPanel / cPanel**:
   * **Node.js Version**: Select `20.x` (or `22.x`).
   * **Application Mode**: Select `Production`.
   * **Application Root**: The path to your project root (e.g., `public_html` or `fresherp`).
   * **Application Startup File**: Select `dist/server.cjs` (or `server.cjs`).
   * **Application URL**: Select your domain/subdomain.

3. **Install Dependencies & Build**:
   * Open the Hostinger SSH Terminal or use the "NPM Install" button in hPanel.
   * Run:
     ```bash
     npm install
     npm run build
     ```
   * This generates `dist/` containing `dist/server.cjs`, `dist/index.html`, `dist/assets/`, `dist/.htaccess`, and `dist/sql-wasm.wasm`.

4. **Environment Variables**:
   * In hPanel Node.js Manager, add Environment Variables:
     * `NODE_ENV=production`
     * `PORT=3000` (or leave default if passenger sets its own socket)
     * `DATA_DIR=./data`
     * `GEMINI_API_KEY=` (optional, for AI features)

5. **Start / Restart Application**:
   * Click **Restart** in the Node.js App dashboard.
   * Visit `https://yourdomain.com` in your browser.

---

## Deployment Option 2: Hostinger VPS (Ubuntu / Debian with PM2 + Nginx)

1. **Clone or Copy Code to Server**:
   ```bash
   cd /var/www/fresherp
   npm install --production=false
   npm run build
   ```

2. **Permissions**:
   ```bash
   mkdir -p data uploads production/uploads production/backups
   chmod -R 755 data uploads production
   ```

3. **Start with PM2**:
   ```bash
   pm2 start ecosystem.config.cjs
   pm2 save
   pm2 startup
   ```

4. **Configure Nginx Reverse Proxy**:
   ```nginx
   server {
       listen 80;
       server_name erp.yourdomain.com;

       client_max_body_size 25M;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

5. **Enable SSL Certificate**:
   ```bash
   certbot --nginx -d erp.yourdomain.com
   ```

---

## Verification Checklist

1. **Dashboard & Login**: Navigate to `/login` and sign in with your administrator credentials.
2. **Fruit Master**: Navigate to `/fruit-master`, verify all fruits appear with their respective icons.
3. **Company Profiles**: Open Settings > Company Bill Profiles, verify Company A ("Hari Kripa Fruit Company") and Company B ("ABC Fruits & Vegetables") are present and configurable.
4. **Billing & Invoice**:
   * Create a bill under Company A; verify the preview and print invoice reflect only Company A.
   * Create a bill under Company B; verify the preview and print invoice reflect only Company B.
5. **Direct Navigation / Refresh**: Refresh the page on `/sales`, `/customers`, `/inventory`, `/fruit-master`, `/reports`. Verify that no 404 occurs.
6. **Uploads**: Add or edit a fruit, upload a photo, and refresh to confirm the image persists and displays properly.
