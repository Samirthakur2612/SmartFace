const express = require('express');
const Class = require('../models/Class');
const auth = require('../middleware/auth');
const { getAuthUser } = require('../middleware/roles');
const router = express.Router();

// Get all active classes
router.get('/', async (req, res) => {
    try {
        const classes = await Class.find({ isActive: true }).sort({ startTime: 1 });
        res.json(classes);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Get class by ID
router.get('/:classId', async (req, res) => {
    try {
        const classObj = await Class.findById(req.params.classId);
        if (!classObj) {
            return res.status(404).json({ message: 'Class not found' });
        }
        res.json(classObj);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Get class active now (based on current time)
router.get('/current-class/now', async (req, res) => {
    try {
        const now = new Date();
        const currentTime = now.getHours().toString().padStart(2, '0') + ':' + 
                           now.getMinutes().toString().padStart(2, '0');
        const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];

        // Find class where current time falls between startTime and endTime
        const activeClass = await Class.findOne({
            isActive: true,
            startTime: { $lte: currentTime },
            endTime: { $gte: currentTime },
            $or: [
                { dayOfWeek: { $size: 0 } }, // Empty days = daily
                { dayOfWeek: dayName }        // Or specific day
            ]
        });

        if (!activeClass) {
            return res.status(404).json({ message: 'No class is active right now' });
        }

        res.json({ 
            classActive: true,
            class: activeClass,
            currentTime: currentTime,
            dayName: dayName
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Create new class (Admin only)
router.post('/', auth, async (req, res) => {
    try {
        const user = await getAuthUser(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }
        const { className, startTime, endTime, dayOfWeek, description } = req.body;

        if (!className || !startTime || !endTime) {
            return res.status(400).json({ message: 'Missing required fields: className, startTime, endTime' });
        }

        // Validate time format (HH:MM)
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
            return res.status(400).json({ message: 'Time format must be HH:MM (24-hour)' });
        }

        // Validate that endTime is after startTime
        if (endTime <= startTime) {
            return res.status(400).json({ message: 'End time must be after start time' });
        }

        const newClass = new Class({
            className,
            startTime,
            endTime,
            dayOfWeek: dayOfWeek || [],
            description: description || ''
        });

        await newClass.save();
        console.log(`[Class] Created: ${className} (${startTime} - ${endTime})`);

        res.status(201).json({
            message: 'Class created successfully',
            class: newClass
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Update class (Admin only)
router.put('/:classId', auth, async (req, res) => {
    try {
        const user = await getAuthUser(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }
        const { className, startTime, endTime, dayOfWeek, description, isActive } = req.body;

        let classObj = await Class.findById(req.params.classId);
        if (!classObj) {
            return res.status(404).json({ message: 'Class not found' });
        }

        // Validate time format if provided
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (startTime && !timeRegex.test(startTime)) {
            return res.status(400).json({ message: 'Start time format must be HH:MM' });
        }
        if (endTime && !timeRegex.test(endTime)) {
            return res.status(400).json({ message: 'End time format must be HH:MM' });
        }

        // Validate logic
        const newStart = startTime || classObj.startTime;
        const newEnd = endTime || classObj.endTime;
        if (newEnd <= newStart) {
            return res.status(400).json({ message: 'End time must be after start time' });
        }

        // Update fields
        if (className) classObj.className = className;
        if (startTime) classObj.startTime = startTime;
        if (endTime) classObj.endTime = endTime;
        if (dayOfWeek !== undefined) classObj.dayOfWeek = dayOfWeek;
        if (description !== undefined) classObj.description = description;
        if (isActive !== undefined) classObj.isActive = isActive;
        classObj.updatedAt = new Date();

        await classObj.save();
        console.log(`[Class] Updated: ${classObj.className}`);

        res.json({
            message: 'Class updated successfully',
            class: classObj
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Delete class (Admin only)
router.delete('/:classId', auth, async (req, res) => {
    try {
        const user = await getAuthUser(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }
        const classObj = await Class.findByIdAndDelete(req.params.classId);
        if (!classObj) {
            return res.status(404).json({ message: 'Class not found' });
        }

        console.log(`[Class] Deleted: ${classObj.className}`);
        res.json({ message: 'Class deleted successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
