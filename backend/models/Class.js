const mongoose = require('mongoose');

const ClassSchema = new mongoose.Schema({
    className: { type: String, required: true }, // e.g., "Mathematics-A", "English-B"
    startTime: { type: String, required: true }, // Format: HH:MM (24-hour) e.g., "09:00"
    endTime: { type: String, required: true },   // Format: HH:MM (24-hour) e.g., "10:00"
    dayOfWeek: { type: [String], default: [] },  // ["Monday", "Tuesday", etc.] - empty = daily
    description: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Class', ClassSchema);
