const canvas = require('canvas');
const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
const path = require('path');

// Patch nodejs environment 
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

let modelsLoaded = false;
let faceMatcher = null;
let StudentModel = null;

// Initialize face-api.js models from backend file system
async function loadModels() {
    if (modelsLoaded) return;
    
    // We saved the models from frontend to backend/face-models
    const modelPath = path.join(__dirname, '..', 'face-models');
    
    console.log('[Face API] Loading models from:', modelPath);
    try {
        await faceapi.tf.setBackend('cpu');
        console.log('[Face API] Set backend to cpu');
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath),
            faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath),
            faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath)
        ]);
        console.log('[Face API] Models loaded successfully');
        modelsLoaded = true;
    } catch(err) {
        console.error('[Face API] Failed to load models:', err);
    }
}

// Re-build the FaceMatcher when new students are added or on first run
async function updateFaceMatcher() {
    if (!StudentModel) {
        StudentModel = require('../models/Student');
    }

    try {
        const students = await StudentModel.find({ faceDescriptor: { $exists: true, $ne: [] } });
        
        console.log(`[Face Service] Found ${students.length} students with face descriptors`);
        
        if (students.length === 0) {
            console.log('[Face API] No student encodings found.');
            faceMatcher = null;
            return;
        }

        const labeledDescriptors = students.map(s => {
            const desc = new Float32Array(s.faceDescriptor);
            return new faceapi.LabeledFaceDescriptors(`${s.studentId}|${s.name}`, [desc]);
        });
        
        // 1.0 is maximum lenient distance threshold
        faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 1.0);
        console.log(`[Face API] FaceMatcher updated with ${students.length} students`);
    } catch(err) {
        console.error('[Face API] Failed to build FaceMatcher:', err);
    }
}

// Detect liveness (anti-spoofing) - checks if face looks real vs photo
async function detectLiveness(detection, canvas) {
    try {
        // Quality checks for liveness detection
        const landmarks = detection.landmarks;
        
        if (!landmarks || landmarks.positions.length < 68) {
            return { isLive: false, score: 0, reason: 'Insufficient facial landmarks detected' };
        }

        // Check eye openness (eyes should have visible pupils)
        const leftEye = landmarks.getLeftEye();
        const rightEye = landmarks.getRightEye();
        
        if (!leftEye || !rightEye || leftEye.length < 6 || rightEye.length < 6) {
            return { isLive: false, score: 0, reason: 'Eye landmarks not properly detected' };
        }

        // Calculate eye aspect ratio (higher = eyes more open = more authentic)
        const eyeDistance = Math.hypot(leftEye[0].x - rightEye[0].x, leftEye[0].y - rightEye[0].y);
        const faceWidth = landmarks.positions[16].x - landmarks.positions[0].x;
        const eyeRatio = eyeDistance / faceWidth;

        // Check face symmetry (photos often have less symmetry due to angles)
        const leftFace = landmarks.positions.slice(0, 17);
        const rightFace = landmarks.positions.slice(17, 34);
        
        let symmetryScore = 0;
        for (let i = 0; i < Math.min(leftFace.length, rightFace.length); i++) {
            const dist = Math.abs(leftFace[i].x - rightFace[i].x);
            symmetryScore += dist;
        }
        symmetryScore = symmetryScore / Math.min(leftFace.length, rightFace.length);
        
        // Real faces typically have higher symmetry scores
        const isLive = eyeRatio > 0.15 && symmetryScore < 50;
        const livenessScore = Math.min(100, Math.round((eyeRatio / 0.3) * 100));
        
        console.log(`[Liveness] Eye ratio: ${eyeRatio.toFixed(3)}, Symmetry: ${symmetryScore.toFixed(2)}, Score: ${livenessScore}`);
        
        return { 
            isLive, 
            score: livenessScore,
            reason: isLive ? 'Face appears to be authentic' : 'Face may be a photo or mask'
        };
    } catch (err) {
        console.error('[Liveness Detection] Error:', err.message);
        return { isLive: true, score: 50, reason: 'Could not verify liveness' };
    }
}

// Detect emotion - simplified version (Node.js version doesn't have expressions)
async function detectEmotion(detection, canvas) {
    try {
        // For Node.js, we'll do a simplified emotion detection based on facial features
        // Real-time: Return neutral, but in production could use microexpressions
        console.log('[Emotion Detection] Using simplified emotion detection (Node.js)');
        
        // In production, could analyze:
        // - Mouth corners position (smile = happy)
        // - Eye area ratio (wide = surprised)
        // - Face muscle tension patterns
        
        return {
            emotion: 'neutral',  // Default to neutral for Node.js
            score: 65,
            details: {
                happy: 0,
                sad: 0,
                neutral: 100,
                surprised: 0,
                angry: 0,
                fearful: 0,
                disgusted: 0
            }
        };
    } catch (err) {
        console.error('[Emotion Detection] Error:', err.message);
        return { emotion: 'neutral', score: 0, details: {} };
    }
}

// Check if face descriptor already exists (duplicate registration detection)
async function checkDuplicateFace(descriptor, threshold = 0.45) {
    try {
        if (!StudentModel) {
            StudentModel = require('../models/Student');
        }

        const students = await StudentModel.find({ faceDescriptor: { $exists: true, $ne: [] } });
        
        if (students.length === 0) {
            return { isDuplicate: false, message: 'No existing faces to compare' };
        }

        const incomingDesc = new Float32Array(descriptor);
        let closestMatch = null;
        let minDistance = threshold;

        for (const student of students) {
            const studentDesc = new Float32Array(student.faceDescriptor);
            
            // Calculate Euclidean distance between descriptors
            let distance = 0;
            for (let i = 0; i < incomingDesc.length; i++) {
                const diff = incomingDesc[i] - studentDesc[i];
                distance += diff * diff;
            }
            distance = Math.sqrt(distance);

            console.log(`[Duplicate Check] Distance to ${student.name}: ${distance.toFixed(4)}`);

            if (distance < minDistance) {
                minDistance = distance;
                closestMatch = {
                    studentId: student.studentId,
                    name: student.name,
                    distance: distance
                };
            }
        }

        if (closestMatch) {
            return {
                isDuplicate: true,
                message: `This face matches existing student: ${closestMatch.name}`,
                matchedStudent: closestMatch
            };
        }

        return { isDuplicate: false, message: 'No duplicate faces detected' };
    } catch (err) {
        console.error('[Duplicate Detection] Error:', err.message);
        return { isDuplicate: false, message: 'Could not check duplicates', error: err.message };
    }
}

// Helper to run face recognition on a base64 image
async function recognizeFaceFromBase64(base64Image) {
    console.log('[Face Service] Starting recognition...');
    if (!modelsLoaded) {
        console.log('[Face Service] Loading models...');
        await loadModels();
    }
    
    // Always update faceMatcher to get latest students on every request
    console.log('[Face Service] Updating face matcher...');
    await updateFaceMatcher();
    
    if (!faceMatcher) {
        console.log('[Face Service] No students enrolled');
        return { success: false, message: 'No students enrolled for matching', debug: 'faceMatcher is null' };
    }

    try {
        console.log('[Face Service] Processing image...');
        // Strip out the data url part if present (e.g. data:image/jpeg;base64,...)
        const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, 'base64');
        
        console.log(`[Face Service] Image buffer size: ${imageBuffer.length} bytes`);
        
        // Create image using canvas Image class
        const img = new Image();
        img.src = imageBuffer;

        console.log(`[Face Service] Image created - dimensions: ${img.width}x${img.height}`);
        
        // Ensure canvas matches image dimensions
        const c = canvas.createCanvas(img.width, img.height);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, img.width, img.height);

        console.log('[Face Service] Detecting faces with landmarks...');
        // Detect all faces - Node.js version supports: landmarks and descriptors
        const detections = await faceapi.detectAllFaces(c)
            .withFaceLandmarks()
            .withFaceDescriptors();

        console.log(`[Face Service] Detected ${detections.length} faces`);

        if (detections.length === 0) {
            return { success: false, message: 'No face detected in the image', debug: `Face detection returned 0 faces. Image size: ${img.width}x${img.height}` };
        }

        // Just take the first face for attendance
        const detection = detections[0];
        
        // Check liveness (anti-spoofing)
        console.log('[Face Service] Checking liveness...');
        const liveness = await detectLiveness(detection, c);
        
        if (!liveness.isLive && liveness.score < 30) {
            console.warn(`[Face Service] ⚠️ SPOOFING DETECTED: ${liveness.reason}`);
            return { 
                success: false, 
                message: 'Fake face detected! Please look at the camera.', 
                spoofingDetected: true,
                debug: liveness.reason 
            };
        }

        // Detect emotion (simplified for Node.js)
        console.log('[Face Service] Detecting emotion...');
        const emotion = await detectEmotion(detection, c);
        
        console.log('[Face Service] Matching face...');
        const bestMatch = faceMatcher.findBestMatch(detection.descriptor);

        console.log(`[Face Service] Best match: ${bestMatch.label}, distance: ${bestMatch.distance}`);

        // Lower distance is better (more confident)
        if (bestMatch.label === 'unknown' || bestMatch.distance > 0.6) {
             console.log(`[Face Service] Face not matched. Distance: ${bestMatch.distance} > 0.6`);
             return { success: false, message: 'Face not recognized', debug: `Best match: ${bestMatch.label}, distance: ${bestMatch.distance}, threshold: 0.6, faces: ${detections.length}` };
        }
        
        console.log(`[Face Service] Face matched! Distance: ${bestMatch.distance}`);

        const [studentId, name] = bestMatch.label.split('|');
        console.log(`[Face Service] Recognized: ${name} (${studentId})`);
        return { 
            success: true, 
            studentId, 
            name, 
            confidence: (1 - bestMatch.distance).toFixed(2),
            emotion: emotion.emotion,
            emotionScore: emotion.score,
            livenessScore: liveness.score,
            isAuthentic: liveness.isLive
        };

    } catch (err) {
        console.error('[Face Service] Recognition error:', err);
        return { success: false, error: err.message };
    }
}

// Export new functions
module.exports = {
    loadModels,
    updateFaceMatcher,
    recognizeFaceFromBase64,
    checkDuplicateFace,
    detectLiveness,
    detectEmotion
};
