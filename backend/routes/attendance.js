const express = require('express');
const Attendance = require('../models/Attendance');
const auth = require('../middleware/auth');
const { getAuthUser } = require('../middleware/roles');
const { isApproved } = require('../utils/accessControl');
const faceService = require('../utils/faceService');
const Class = require('../models/Class');
const router = express.Router();

// Helper function to check class timing
async function getClassTimingStatus(scanTime, dayOfWeek) {
    try {
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(scanTime)) {
            return { status: null, message: 'Invalid scan time format' };
        }

        const activeClasses = await Class.find({ isActive: true });
        
        // Filter by day of week
        const validClasses = activeClasses.filter(cls => 
            cls.dayOfWeek.length === 0 || cls.dayOfWeek.includes(dayOfWeek)
        );

        if (validClasses.length === 0) {
            return { status: 'no-class', class: null, message: 'No class scheduled today' };
        }

        const [scanH, scanM] = scanTime.split(':').map(Number);
        const scanTotalMins = scanH * 60 + scanM;

        let matchedClass = null;
        let timingStatus = 'no-class';
        let minutesLate = 0;

        for (const cls of validClasses) {
            const [startH, startM] = cls.startTime.split(':').map(Number);
            const [endH, endM] = cls.endTime.split(':').map(Number);
            const startTotalMins = startH * 60 + startM;
            const endTotalMins = endH * 60 + endM;

            // Check if scan time is within [startTime - 10 mins, endTime]
            if (scanTotalMins >= startTotalMins - 10 && scanTotalMins <= endTotalMins) {
                matchedClass = cls;
                const diff = scanTotalMins - startTotalMins;
                
                if (diff > 10) {
                    timingStatus = 'late';
                    minutesLate = diff;
                } else {
                    timingStatus = 'on-time';
                    minutesLate = diff > 0 ? diff : 0;
                }
                break;
            }
        }

        if (!matchedClass) {
            return { status: 'no-class', class: null, message: 'No class scheduled at this time' };
        }

        return {
            status: timingStatus,
            class: matchedClass,
            minutesLate: minutesLate,
            message: timingStatus === 'on-time' ? 'On time' : `${minutesLate} minutes late`
        };
    } catch (err) {
        console.error('[Class Timing] Error:', err.message);
        return { status: null, message: 'Error checking class timing', error: err.message };
    }
}

// Custom face recognition from backend (Accepts Base64 image) with class timing validation
router.post('/scan-custom', async (req, res) => {
    console.log('[Attendance Scan] Received scan request');
    const startTime = Date.now();
    
    try {
        const { imageBase64 } = req.body;
        
        if (!imageBase64) {
             console.log('[Attendance Scan] No image provided');
             return res.status(400).json({ message: 'No image provided' });
        }

        console.log(`[Attendance Scan] Image size: ${imageBase64.length} bytes`);
        console.log('[Attendance Scan] Processing image...');
        
        // Get current date and time
        const now = new Date();
        const yyyy = now.getFullYear();
        let mm = now.getMonth() + 1;
        let dd = now.getDate();
        if (dd < 10) dd = '0' + dd;
        if (mm < 10) mm = '0' + mm;
        const dateStr = yyyy + '-' + mm + '-' + dd;
        
        const scanTime = now.getHours().toString().padStart(2, '0') + ':' + 
                        now.getMinutes().toString().padStart(2, '0');
        const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];

        console.log(`[Attendance Scan] Scan time: ${scanTime}, Day: ${dayOfWeek}, Date: ${dateStr}`);

        // Check class timing
        const classTimingResult = await getClassTimingStatus(scanTime, dayOfWeek);
        console.log('[Attendance Scan] Class timing result:', classTimingResult);

        if (classTimingResult.status === 'no-class') {
            return res.status(400).json({ 
                message: 'No class scheduled at this time. Please come during class hours.',
                timingStatus: 'no-class',
                scanTime: scanTime,
                dayOfWeek: dayOfWeek
            });
        }

        if (!classTimingResult.class) {
            return res.status(400).json({ 
                message: classTimingResult.message || 'Could not validate class timing',
                timingStatus: classTimingResult.status
            });
        }

        // Proceed with face recognition even if late, so we can mark them as absent in the database


        // Set a timeout for face recognition processing
        const recognitionTimeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Face recognition took too long (60s timeout)')), 60000)
        );
        
        // Run detection on backend with timeout protection
        const result = await Promise.race([
            faceService.recognizeFaceFromBase64(imageBase64),
            recognitionTimeout
        ]);

        const processingTime = Date.now() - startTime;
        console.log(`[Attendance Scan] Recognition completed in ${processingTime}ms`);
        console.log('[Attendance Scan] Recognition result:', result);

        if (!result.success) {
             console.log('[Attendance Scan] Recognition failed:', result.message);
             
             if (result.spoofingDetected) {
                 return res.status(403).json({ 
                     message: result.message,
                     spoofingDetected: true,
                     debug: result.debug
                 });
             }
             
             return res.status(400).json({ 
                 message: result.message || 'Recognition failed',
                 debug: result.debug || 'No debug info'
             });
        }

        // Face recognized, attempt to mark attendance with class info
        const { studentId, name, confidence, emotion, emotionScore, livenessScore, isAuthentic } = result;

        console.log(`[Attendance Scan] Attempting to mark attendance for ${name} (${studentId}) on ${dateStr} at ${scanTime}`);
        
        const attendanceStatus = classTimingResult.status === 'late' ? 'absent' : 'present';

        const attendance = new Attendance({ 
            studentId, 
            name, 
            date: dateStr,
            classId: classTimingResult.class._id,
            className: classTimingResult.class.className,
            classStartTime: classTimingResult.class.startTime,
            classEndTime: classTimingResult.class.endTime,
            scanTime: scanTime,
            timingStatus: classTimingResult.status,
            status: attendanceStatus,
            minutesLate: classTimingResult.minutesLate || 0
        });
        
        try {
            await attendance.save();
            console.log(`[Attendance Scan] ✓ Successfully marked attendance for ${name} (${studentId}) in class ${classTimingResult.class.className}`);

            const responseMessage = attendanceStatus === 'absent' 
                ? `❌ LATE! You arrived ${classTimingResult.minutesLate} minute(s) late. Attendance marked as ABSENT.`
                : `✓ Attendance marked for ${classTimingResult.class.className}`;

            res.status(201).json({ 
                message: responseMessage, 
                name,
                confidence,
                studentId,
                className: classTimingResult.class.className,
                scanTime: scanTime,
                timingStatus: classTimingResult.status,
                status: attendanceStatus,
                emotion: emotion,
                emotionScore: emotionScore,
                livenessScore: livenessScore,
                isAuthentic: isAuthentic
            });
        } catch (saveErr) {
            if (saveErr.code === 11000) {
                // Duplicate attendance - student already marked for today
                const markedTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                const message = `✓ Already marked! ${name} is present in ${classTimingResult.class.className} (marked at ${markedTime})`;
                console.log(`[Attendance Scan] DUPLICATE - ${message}`);
                return res.status(409).json({ 
                    message: message,
                    name: name,
                    className: classTimingResult.class.className,
                    duplicate: true,
                    alreadyMarked: true,
                    emotion: emotion,
                    emotionScore: emotionScore
                });
            }
            throw saveErr;
        }

    } catch (err) {
        const totalTime = Date.now() - startTime;
        console.error(`[Attendance Scan] ERROR after ${totalTime}ms:`, err.message);
        console.error('[Attendance Scan] Full error:', err);
        
        if (err.message.includes('took too long')) {
            console.error('[Attendance Scan] Timeout error detected');
            return res.status(408).json({ 
                message: 'Face recognition processing took too long. Please try again.',
                error: err.message 
            });
        }
        
        res.status(500).json({ 
            message: 'Server error marking attendance',
            error: err.message 
        });
    }
});

// Record attendance (client-side kiosk API)
router.post('/', async (req, res) => {
    try {
        const { studentId, name } = req.body;

        // Format date to YYYY-MM-DD
        const today = new Date();
        const yyyy = today.getFullYear();
        let mm = today.getMonth() + 1; // Months start at 0!
        let dd = today.getDate();

        if (dd < 10) dd = '0' + dd;
        if (mm < 10) mm = '0' + mm;

        const dateStr = yyyy + '-' + mm + '-' + dd;

        // Create new attendance record
        const attendance = new Attendance({
            studentId,
            name,
            date: dateStr
        });

        await attendance.save();
        res.status(201).json({ message: 'Attendance marked successfully', attendance });
    } catch (err) {
        if (err.code === 11000) {
            // Document already exists for this student and date
            return res.status(400).json({ message: 'Attendance already marked for today' });
        }
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Get attendance records (admin: all, student: own only)
router.get('/', auth, async (req, res) => {
    try {
        const user = await getAuthUser(req);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (!isApproved(user)) {
            return res.status(403).json({ message: 'Account not approved yet' });
        }

        const { date } = req.query;
        let query = {};
        if (date) {
            query.date = date;
        }

        if (user.role === 'student') {
            if (!user.studentId) {
                return res.status(403).json({ message: 'Link your Student ID first' });
            }
            query.studentId = user.studentId;
        } else if (user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const records = await Attendance.find(query).sort({ timestamp: -1 });
        res.json(records);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Update attendance status (admin only)
router.put('/:recordId', auth, async (req, res) => {
    try {
        const user = await getAuthUser(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }

        const { recordId } = req.params;
        const { status } = req.body;

        // Validate status
        if (!['present', 'absent', 'leave'].includes(status)) {
            return res.status(400).json({ message: 'Invalid status. Must be present, absent, or leave' });
        }

        const record = await Attendance.findByIdAndUpdate(
            recordId,
            { status },
            { new: true }
        );

        if (!record) {
            return res.status(404).json({ message: 'Attendance record not found' });
        }

        res.json({ message: 'Attendance status updated', record });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ message: 'Server Error' });
    }
});

// Export to CSV (admin only)
router.get('/export', auth, async (req, res) => {
    try {
        const user = await getAuthUser(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }

        const records = await Attendance.find({}).sort({ timestamp: -1 });

        let csvContent = "Timestamp,Date,Student ID,Name,Status\n";
        records.forEach(record => {
            csvContent += `${record.timestamp.toISOString()},${record.date},${record.studentId},"${record.name}",${record.status}\n`;
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=\"attendance_report.csv\"');
        res.send(csvContent);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
