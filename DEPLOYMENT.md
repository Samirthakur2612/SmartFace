# SmartFace Deployment Guide

## Backend Deployment (Render)

### Step 1: Prepare the Backend
1. Inside `backend/.env.example`, update:
   - `MONGO_URI` → Use MongoDB Atlas (cloud) instead of localhost
   - `CLERK_PUBLISHABLE_KEY` & `CLERK_SECRET_KEY` → Get from Clerk
   - `APP_URL` → Will be your Render URL (e.g., `https://smartface-backend.render.com`)
   - Email credentials if needed

2. Ensure `backend/package.json` has:
   ```json
   "start": "node server.js"
   ```

### Step 2: Deploy to Render

1. Go to [render.com](https://render.com)
2. Sign up / log in
3. Click **New +** → **Web Service**
4. Connect your GitHub repo (`Samirthakur2612/SmartFace`)
5. Configuration:
   - **Name:** `smartface-backend`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free tier
6. Add **Environment Variables** (from `.env.example`):
   ```
   PORT=10000  (Render assigns a port, don't use 5000)
   MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/face_attendance
   CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   OWNER_EMAIL=samirthakur829@gmail.com
   APP_URL=https://smartface-backend-xxx.render.com
   ```
7. Click **Create Web Service**
8. Wait ~5 min for deploy. Copy the deployed URL (e.g., `https://smartface-backend-xxx.render.com`)

### Step 3: Update Frontend API Calls

Edit `frontend/js/app.js`:
```javascript
// Add at the top or in a config section:
const API_BASE_URL = 'https://smartface-backend-xxx.render.com';

// Then replace all fetch calls:
// From: fetch('/api/students')
// To:   fetch(API_BASE_URL + '/api/students')
```

### Step 4: Update Backend CORS

In `backend/server.js`, update CORS to allow Vercel frontend:
```javascript
app.use(cors({
  origin: ['http://localhost:5000', 'https://your-vercel-url.vercel.app'],
  credentials: true
}));
```

### Step 5: Redeploy Frontend

Push the updated frontend API URLs:
```bash
git add frontend/js/app.js backend/server.js
git commit -m "Update API base URL for deployed backend"
git push
```

Vercel will auto-deploy.

---

## Frontend Deployment (Vercel)

Already configured in `vercel.json`. Just ensure:
- Vercel project is connected to GitHub
- Auto-deploy on push is enabled
- Check deployment logs if issues arise

---

## MongoDB Setup (Required)

1. Go to [mongodb.com/cloud](https://mongodb.com/cloud)
2. Create cluster (free tier available)
3. Get connection string → paste into `MONGO_URI`

---

## Quick Test

Once deployed:
```bash
curl https://smartface-backend-xxx.render.com/api/students
```
Should return `[]` or a list of students (not an error).

