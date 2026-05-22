require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const { clerkMiddleware } = require('@clerk/express');

const studentRoutes = require('./routes/students');
const attendanceRoutes = require('./routes/attendance');
const userRoutes = require('./routes/users');
const leaveRoutes = require('./routes/leaves');
const classRoutes = require('./routes/classes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(clerkMiddleware());

app.use((req, res, next) => {
    // Only log API requests to avoid spam
    if (req.path.startsWith('/api')) {
        console.log(`[DEBUG Backend] API Request to ${req.path}`);
        console.log(`[DEBUG Backend] Auth Header:`, req.headers.authorization ? 'Present' : 'Missing');
        console.log(`[DEBUG Backend] req.auth (Clerk):`, req.auth);
        console.log(`[DEBUG Backend] Keys present: Pub=${!!process.env.CLERK_PUBLISHABLE_KEY}, Sec=${!!process.env.CLERK_SECRET_KEY}`);
    }
    next();
});

// Serve frontend (static HTML/JS)
const frontendDir = path.resolve(__dirname, '..', 'frontend');

// Define page routes BEFORE static file serving
app.get('/', (_req, res) => res.sendFile(path.join(frontendDir, 'index.html'), (err) => {
    if (err) console.error('Error serving index.html:', err);
}));
app.get('/admin-register', (_req, res) => res.sendFile(path.join(frontendDir, 'admin-register.html')));
app.get('/register', (_req, res) => res.sendFile(path.join(frontendDir, 'register.html')));
app.get('/dashboard', (_req, res) => res.sendFile(path.join(frontendDir, 'dashboard.html')));
app.get('/attendance', (_req, res) => res.sendFile(path.join(frontendDir, 'attendance.html')));
app.get('/attendance-records', (_req, res) => {
    console.log('[Route] Serving attendance-records.html');
    res.sendFile(path.join(frontendDir, 'attendance-records.html'), (err) => {
        if (err) console.error('[Route Error] Failed to serve attendance-records.html:', err);
    });
});
app.get('/attendance-scan', (_req, res) => res.sendFile(path.join(frontendDir, 'attendance-scan.html')));
app.get('/students', (_req, res) => res.sendFile(path.join(frontendDir, 'students.html')));
app.get('/my-leaves', (_req, res) => res.sendFile(path.join(frontendDir, 'my-leaves.html')));
app.get('/leave-management', (_req, res) => {
    console.log('[Route] Serving leave-management.html');
    res.sendFile(path.join(frontendDir, 'leave-management.html'), (err) => {
        if (err) console.error('[Route Error] Failed to serve leave-management.html:', err);
    });
});
app.get('/leaves-calendar', (_req, res) => {
    console.log('[Route] Serving leaves-calendar.html');
    res.sendFile(path.join(frontendDir, 'leaves-calendar.html'), (err) => {
        if (err) console.error('[Route Error] Failed to serve leaves-calendar.html:', err);
    });
});
app.get('/role-selection', (_req, res) => res.sendFile(path.join(frontendDir, 'role-selection.html')));
app.get('/admin-approval', (_req, res) => res.sendFile(path.join(frontendDir, 'admin-approval.html')));
app.get('/waiting-approval', (_req, res) => res.sendFile(path.join(frontendDir, 'waiting-approval.html')));
app.get('/access-requests', (_req, res) => res.sendFile(path.join(frontendDir, 'access-requests.html')));
app.get('/link-student', (_req, res) => res.sendFile(path.join(frontendDir, 'link-student.html')));
app.get('/student-dashboard', (_req, res) => res.sendFile(path.join(frontendDir, 'student-dashboard.html')));
app.get('/student-leaves-calendar', (_req, res) => res.sendFile(path.join(frontendDir, 'student-leaves-calendar.html')));
app.get('/add-class', (_req, res) => {
    console.log('[Route] Serving add-class.html');
    res.sendFile(path.join(frontendDir, 'add-class.html'), (err) => {
        if (err) console.error('[Route Error] Failed to serve add-class.html:', err);
    });
});
app.get('/class-management', (_req, res) => {
    console.log('[Route] Serving class-management.html');
    res.sendFile(path.join(frontendDir, 'class-management.html'), (err) => {
        if (err) console.error('[Route Error] Failed to serve class-management.html:', err);
    });
});

// API Routes
app.use('/api/students', studentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/users', userRoutes);
app.use('/api/classes', classRoutes);

// Serve static files AFTER route handlers
app.use(express.static(frontendDir));

// Debug: list all registered routes
const listRoutes = () => {
    if (!app._router || !app._router.stack) {
        console.log('[Routes] No router stack available yet');
        return;
    }

    const routes = [];
    app._router.stack.forEach((middleware) => {
        if (middleware.route) {
            const methods = Object.keys(middleware.route.methods).join(', ').toUpperCase();
            routes.push(`${methods} ${middleware.route.path}`);
        } else if (middleware.name === 'router' && middleware.handle && middleware.handle.stack) {
            middleware.handle.stack.forEach((handler) => {
                if (handler.route) {
                    const methods = Object.keys(handler.route.methods).join(', ').toUpperCase();
                    routes.push(`${methods} ${handler.route.path}`);
                }
            });
        }
    });
    console.log('[Routes]', routes.sort().join(' | '));
};
listRoutes();

// Catch-all 404 handler - log unmatched routes
app.use((req, res) => {
    console.error(`[404] Unmatched route: ${req.method} ${req.path}`);
    res.status(404).json({ message: `Cannot ${req.method} ${req.path}` });
});

// Initialize Face Models on backend
const faceService = require('./utils/faceService');
faceService.loadModels().catch(console.error);

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/face_attendance', {})
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log('Database connection error:', err));

const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Set high timeout for /api/attendance/scan-custom to allow face recognition processing
server.setTimeout(120000); // 2 minutes total request timeout
server.keepAliveTimeout = 90000; // 90 seconds keep-alive timeout
