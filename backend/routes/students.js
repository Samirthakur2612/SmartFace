const express = require('express');
const Student = require('../models/Student');
const auth = require('../middleware/auth');
const { getAuthUser } = require('../middleware/roles');
const router = express.Router();

async function requireAdminUser(req, res) {
    const user = await getAuthUser(req);
    if (!user || user.role !== 'admin') {
        res.status(403).json({ message: 'Admin access required' });
        return null;
    }
    return user;
}

// Public: for kiosk face-matching (only descriptors)
router.get('/', async (req, res) => {
    try {
        const students = await Student.find({}, 'studentId name faceDescriptor');
        res.json(students);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Admin: full list for management (no descriptors)
router.get('/all', auth, async (req, res) => {
    try {
        if (!(await requireAdminUser(req, res))) return;
        const students = await Student.find({}, '-faceDescriptor').sort({ createdAt: -1 });
        res.json(students);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Register a new student (admin only)
router.post('/', auth, async (req, res) => {
    try {
        if (!(await requireAdminUser(req, res))) return;
        const { studentId, name, email, faceDescriptor } = req.body;

        let student = await Student.findOne({ studentId });
        if (student) {
            return res.status(400).json({ message: 'Student already registered' });
        }

        // Check for duplicate faces (prevent same face registering twice)
        const faceService = require('../utils/faceService');
        const duplicateCheck = await faceService.checkDuplicateFace(faceDescriptor);
        
        if (duplicateCheck.isDuplicate) {
            console.warn(`[Student Registration] Duplicate face detected: ${duplicateCheck.matchedStudent.name}`);
            return res.status(409).json({ 
                message: `This face is already registered for ${duplicateCheck.matchedStudent.name}. Please register with a different face.`,
                isDuplicate: true,
                matchedStudent: duplicateCheck.matchedStudent.name
            });
        }

        student = new Student({
            studentId,
            name,
            email: email ? email.toLowerCase().trim() : null,
            faceDescriptor
        });
        await student.save();

        // Update the server-side AI model
        await faceService.updateFaceMatcher();

        res.status(201).json({ 
            message: 'Student registered successfully', 
            student: {
                studentId: student.studentId,
                name: student.name,
                createdAt: student.createdAt
            },
            duplicateCheckPassed: true
        });
    } catch (err) {
        console.error(err.message);
        if (err.code === 11000) {
            return res.status(400).json({ message: 'Student ID must be unique' });
        }
        res.status(500).send('Server Error');
    }
});

// Update student basic info (admin only)
router.put('/:studentId', auth, async (req, res) => {
    try {
        if (!(await requireAdminUser(req, res))) return;
        const { name, email } = req.body;
        const updates = {};
        if (name) updates.name = name;
        if (email !== undefined) updates.email = email ? email.toLowerCase().trim() : null;
        const student = await Student.findOneAndUpdate(
            { studentId: req.params.studentId },
            { $set: updates },
            { new: true }
        ).select('-faceDescriptor');

        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }

        res.json({ message: 'Student updated', student });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Delete student (admin only)
router.delete('/:studentId', auth, async (req, res) => {
    try {
        if (!(await requireAdminUser(req, res))) return;
        const student = await Student.findOneAndDelete({ studentId: req.params.studentId });
        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }
        res.json({ message: 'Student deleted' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
