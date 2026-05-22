from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import face_recognition
import numpy as np
import cv2
from pydantic import BaseModel
from typing import List
import io

app = FastAPI(title="AI Face Recognition API")

# Allow CORS for the frontend/node backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

class EncodingsResponse(BaseModel):
    encodings: List[List[float]]

@app.get("/")
def read_root():
    return {"status": "Face Recognition Service is running"}

@app.post("/extract-faces", response_model=EncodingsResponse)
async def extract_faces(file: UploadFile = File(...)):
    """
    Receives an image file and returns the 128-d face encodings for any faces found.
    """
    try:
        # Read image file
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image file")

        # Convert the image from BGR color (which OpenCV uses) to RGB color (which face_recognition uses)
        rgb_img = img[:, :, ::-1]
        
        # Find all the faces and face encodings in the current frame of video
        face_locations = face_recognition.face_locations(rgb_img)
        face_encodings = face_recognition.face_encodings(rgb_img, face_locations)
        
        # Convert numpy arrays to lists for JSON serialization
        encodings_list = [encoding.tolist() for encoding in face_encodings]
        
        return {"encodings": encodings_list}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
