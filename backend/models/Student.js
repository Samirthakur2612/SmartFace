const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
    studentId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, default: null }, // Gmail used to link student account
    faceDescriptor: { type: [Number], required: true } // Array of floats representing the embedding
}, { timestamps: true });

module.exports = mongoose.model('Student', StudentSchema);
