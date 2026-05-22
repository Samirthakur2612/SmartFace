const express = require('express');
const Leave = require('../models/Leave');
const Attendance = require('../models/Attendance');
const auth = require('../middleware/auth');
const { getAuthUser } = require('../middleware/roles');
const { getClerkAuth } = require('../middleware/clerkAuth');
const router = express.Router();

// Apply for leave (Student - own account only)
router.post('/', auth, async (req, res) => {
    try {
        const user = await getAuthUser(req);
        if (!user || user.role !== 'student') {
            return res.status(403).json({ message: 'Only students can apply for leave' });
        }
        if (!user.studentId) {
            return res.status(403).json({ message: 'Link your Student ID first' });
        }

        const { startDate, endDate, reason, leaveType } = req.body;
        const studentId = user.studentId;
        const name = user.name;

        if (!startDate || !endDate || !reason) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        // Calculate number of days
        const start = new Date(startDate);
        const end = new Date(endDate);
        const timeDiff = Math.abs(end - start);
        const numberOfDays = Math.ceil(timeDiff / (1000 * 60 * 60 * 24)) + 1;

        if (numberOfDays <= 0) {
            return res.status(400).json({ message: 'End date must be after start date' });
        }

        // Check for overlapping leave requests
        const existingLeave = await Leave.findOne({
            studentId,
            status: { $ne: 'rejected' },
            $or: [
                { startDate: { $lte: endDate }, endDate: { $gte: startDate } }
            ]
        });

        if (existingLeave) {
            return res.status(409).json({ 
                message: 'You already have a leave request for this period',
                overlappingLeave: existingLeave
            });
        }

        const leave = new Leave({
            studentId,
            name,
            startDate,
            endDate,
            reason,
            leaveType: leaveType || 'casual',
            numberOfDays
        });

        await leave.save();
        console.log(`[Leave] ${name} applied for leave from ${startDate} to ${endDate} (${numberOfDays} days)`);

        res.status(201).json({
            message: 'Leave application submitted successfully',
            leave
        });
    } catch (err) {
        console.error('[Leave Error]:', err.message);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// Get leaves for current student (own) or by ID (admin only)
router.get('/student/:studentId', auth, async (req, res) => {
    try {
        const user = await getAuthUser(req);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        let studentId = req.params.studentId;
        if (user.role === 'student') {
            if (!user.studentId) {
                return res.status(403).json({ message: 'Link your Student ID first' });
            }
            studentId = user.studentId;
        } else if (user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const leaves = await Leave.find({ studentId })
            .sort({ appliedDate: -1 });

        res.json(leaves);
    } catch (err) {
        console.error('[Leave Error]:', err.message);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get own leaves (student shortcut)
router.get('/my', auth, async (req, res) => {
    try {
        const user = await getAuthUser(req);
        if (!user || user.role !== 'student' || !user.studentId) {
            return res.status(403).json({ message: 'Student account with linked ID required' });
        }
        const leaves = await Leave.find({ studentId: user.studentId }).sort({ appliedDate: -1 });
        res.json(leaves);
    } catch (err) {
        console.error('[Leave Error]:', err.message);
        res.status(500).json({ message: 'Server error' });
    }
});

// Calendar: approved leaves (students and admins)
router.get('/calendar', auth, async (req, res) => {
    try {
        const user = await getAuthUser(req);
        if (!user || !['admin', 'student'].includes(user.role)) {
            return res.status(403).json({ message: 'Access denied' });
        }
        const leaves = await Leave.find({ status: 'approved' }).sort({ startDate: -1 });
        res.json(leaves);
    } catch (err) {
        console.error('[Leave Error]:', err.message);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get all pending leave requests (Admin only)
router.get('/admin/pending', auth, async (req, res) => {
    try {
        const user = await getAuthUser(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }
        const leaves = await Leave.find({ status: 'pending' })
            .sort({ appliedDate: -1 });
        
        res.json(leaves);
    } catch (err) {
        console.error('[Leave Error]:', err.message);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get all leave requests (Admin only)
router.get('/admin/all', auth, async (req, res) => {
    try {
        const user = await getAuthUser(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }
        const leaves = await Leave.find({})
            .sort({ appliedDate: -1 });
        
        res.json(leaves);
    } catch (err) {
        console.error('[Leave Error]:', err.message);
        res.status(500).json({ message: 'Server error' });
    }
});

// Approve leave (Admin only)
router.put('/:leaveId/approve', auth, async (req, res) => {
    try {
        const user = await getAuthUser(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }
        const leave = await Leave.findByIdAndUpdate(
            req.params.leaveId,
            {
                status: 'approved',
                reviewedDate: new Date(),
                reviewedBy: getClerkAuth(req)?.userId || 'admin',
                reviewComments: req.body.comments || ''
            },
            { new: true }
        );

        if (!leave) {
            return res.status(404).json({ message: 'Leave request not found' });
        }

        // Create attendance records for leave period
        const start = new Date(leave.startDate);
        const end = new Date(leave.endDate);
        
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            
            // Create or update attendance record with leave status
            await Attendance.findOneAndUpdate(
                { studentId: leave.studentId, date: dateStr },
                { 
                    status: 'leave',
                    leaveId: leave._id
                },
                { upsert: true }
            );
        }

        console.log(`[Leave] Approved leave for ${leave.name} from ${leave.startDate} to ${leave.endDate}`);

        res.json({
            message: 'Leave approved successfully',
            leave
        });
    } catch (err) {
        console.error('[Leave Error]:', err.message);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// Reject leave (Admin only)
router.put('/:leaveId/reject', auth, async (req, res) => {
    try {
        const user = await getAuthUser(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }
        const leave = await Leave.findByIdAndUpdate(
            req.params.leaveId,
            {
                status: 'rejected',
                reviewedDate: new Date(),
                reviewedBy: getClerkAuth(req)?.userId || 'admin',
                reviewComments: req.body.comments || ''
            },
            { new: true }
        );

        if (!leave) {
            return res.status(404).json({ message: 'Leave request not found' });
        }

        console.log(`[Leave] Rejected leave for ${leave.name} from ${leave.startDate} to ${leave.endDate}`);

        res.json({
            message: 'Leave rejected',
            leave
        });
    } catch (err) {
        console.error('[Leave Error]:', err.message);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

// Get leave statistics (own for student, any for admin)
router.get('/stats/:studentId', auth, async (req, res) => {
    try {
        const user = await getAuthUser(req);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        let studentId = req.params.studentId;
        if (user.role === 'student') {
            if (!user.studentId) {
                return res.status(403).json({ message: 'Link your Student ID first' });
            }
            studentId = user.studentId;
        } else if (user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied' });
        }

        const currentYear = new Date().getFullYear();
        
        const approvedLeaves = await Leave.aggregate([
            {
                $match: {
                    studentId: studentId,
                    status: 'approved',
                    startDate: { $gte: currentYear.toString() }
                }
            },
            {
                $group: {
                    _id: '$leaveType',
                    totalDays: { $sum: '$numberOfDays' },
                    count: { $sum: 1 }
                }
            }
        ]);

        const pendingCount = await Leave.countDocuments({
            studentId: studentId,
            status: 'pending'
        });

        res.json({
            approvedLeaves,
            pendingCount,
            year: currentYear
        });
    } catch (err) {
        console.error('[Leave Error]:', err.message);
        res.status(500).json({ message: 'Server error' });
    }
});

// Cancel leave (Student - own pending only)
router.put('/:leaveId/cancel', auth, async (req, res) => {
    try {
        const user = await getAuthUser(req);
        if (!user || user.role !== 'student' || !user.studentId) {
            return res.status(403).json({ message: 'Student access required' });
        }

        const leave = await Leave.findById(req.params.leaveId);
        
        if (!leave) {
            return res.status(404).json({ message: 'Leave request not found' });
        }

        if (leave.studentId !== user.studentId) {
            return res.status(403).json({ message: 'You can only cancel your own leave requests' });
        }

        if (leave.status !== 'pending') {
            return res.status(400).json({ message: 'Only pending leave can be cancelled' });
        }

        leave.status = 'rejected';
        leave.reviewComments = 'Cancelled by student';
        await leave.save();

        console.log(`[Leave] ${leave.name} cancelled their leave request`);

        res.json({
            message: 'Leave cancelled successfully',
            leave
        });
    } catch (err) {
        console.error('[Leave Error]:', err.message);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

module.exports = router;
