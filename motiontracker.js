import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Video, Pencil, Square, Circle, Type, Trash2, Play, Pause, Lock, Unlock, RefreshCw, Users } from 'lucide-react';

const MotionTrackedAnnotationSystem = () => {
  const [videoFile, setVideoFile] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [annotations, setAnnotations] = useState([]);
  const [drawingMode, setDrawingMode] = useState(null);
  const [currentDrawing, setCurrentDrawing] = useState(null);
  const [trackingEnabled, setTrackingEnabled] = useState(true);
  const [selectedTool, setSelectedTool] = useState('pen');
  const [color, setColor] = useState('#FF0000');
  const [connectedUsers, setConnectedUsers] = useState(1);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const previousFrameRef = useRef(null);
  const trackingDataRef = useRef({});
  const animationFrameRef = useRef(null);
  
  // Initialize tracking context for each annotation
  const initializeTracking = (annotation) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    // Create feature region around annotation
    const regionSize = 60;
    const x = Math.max(0, Math.floor(annotation.x - regionSize/2));
    const y = Math.max(0, Math.floor(annotation.y - regionSize/2));
    const w = Math.min(regionSize, canvas.width - x);
    const h = Math.min(regionSize, canvas.height - y);
    
    const region = ctx.getImageData(x, y, w, h);
    
    return {
      id: annotation.id,
      lastPosition: { x: annotation.x, y: annotation.y },
      templateRegion: region,
      templateX: x,
      templateY: y,
      confidence: 1.0,
      lostFrames: 0
    };
  };
  
  // Simple template matching for motion tracking
  const trackAnnotation = (trackingData) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !trackingData.templateRegion) return trackingData;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    
    const searchRadius = 40;
    const template = trackingData.templateRegion;
    const tw = template.width;
    const th = template.height;
    
    let bestMatch = { score: Infinity, x: trackingData.lastPosition.x, y: trackingData.lastPosition.y };
    
    // Search in a window around last known position
    const startX = Math.max(0, Math.floor(trackingData.lastPosition.x - searchRadius));
    const startY = Math.max(0, Math.floor(trackingData.lastPosition.y - searchRadius));
    const endX = Math.min(canvas.width - tw, Math.floor(trackingData.lastPosition.x + searchRadius));
    const endY = Math.min(canvas.height - th, Math.floor(trackingData.lastPosition.y + searchRadius));
    
    // Sample every 4 pixels for performance
    for (let y = startY; y < endY; y += 4) {
      for (let x = startX; x < endX; x += 4) {
        const current = ctx.getImageData(x, y, tw, th);
        const score = computeSSD(template.data, current.data);
        
        if (score < bestMatch.score) {
          bestMatch = { score, x: x + tw/2, y: y + th/2 };
        }
      }
    }
    
    // Calculate confidence based on match quality
    const confidence = Math.max(0, 1 - (bestMatch.score / 1000000));
    const moved = Math.abs(bestMatch.x - trackingData.lastPosition.x) > 2 || 
                  Math.abs(bestMatch.y - trackingData.lastPosition.y) > 2;
    
    if (confidence > 0.3 && moved) {
      return {
        ...trackingData,
        lastPosition: { x: bestMatch.x, y: bestMatch.y },
        confidence,
        lostFrames: 0
      };
    } else if (confidence < 0.3) {
      return {
        ...trackingData,
        confidence,
        lostFrames: trackingData.lostFrames + 1
      };
    }
    
    return trackingData;
  };
  
  // Sum of squared differences for template matching
  const computeSSD = (template, current) => {
    let sum = 0;
    const len = Math.min(template.length, current.length);
    for (let i = 0; i < len; i += 4) {
      const dr = template[i] - current[i];
      const dg = template[i+1] - current[i+1];
      const db = template[i+2] - current[i+2];
      sum += dr*dr + dg*dg + db*db;
    }
    return sum / (len / 4);
  };
  
  // Update all tracked annotations
  const updateTracking = useCallback(() => {
    if (!trackingEnabled || !videoRef.current || videoRef.current.paused) return;
    
    setAnnotations(prevAnnotations => {
      return prevAnnotations.map(annotation => {
        if (!annotation.trackingEnabled) return annotation;
        
        let trackingData = trackingDataRef.current[annotation.id];
        
        if (!trackingData) {
          trackingData = initializeTracking(annotation);
          if (trackingData) {
            trackingDataRef.current[annotation.id] = trackingData;
          }
          return annotation;
        }
        
        trackingData = trackAnnotation(trackingData);
        trackingDataRef.current[annotation.id] = trackingData;
        
        if (trackingData.lostFrames > 30) {
          return { ...annotation, trackingStatus: 'lost' };
        } else if (trackingData.confidence < 0.5) {
          return { ...annotation, trackingStatus: 'uncertain' };
        }
        
        const dx = trackingData.lastPosition.x - annotation.x;
        const dy = trackingData.lastPosition.y - annotation.y;
        
        if (annotation.type === 'path') {
          return {
            ...annotation,
            x: trackingData.lastPosition.x,
            y: trackingData.lastPosition.y,
            points: annotation.points.map(p => ({ x: p.x + dx, y: p.y + dy })),
            trackingStatus: 'active'
          };
        } else {
          return {
            ...annotation,
            x: trackingData.lastPosition.x,
            y: trackingData.lastPosition.y,
            trackingStatus: 'active'
          };
        }
      });
    });
  }, [trackingEnabled]);
  
  // Animation loop for tracking
  useEffect(() => {
    const animate = () => {
      updateTracking();
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    
    if (isPlaying && trackingEnabled) {
      animate();
    }
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, trackingEnabled, updateTracking]);
  
  const handleVideoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoFile(url);
      setAnnotations([]);
      trackingDataRef.current = {};
    }
  };
  
  const handleCanvasMouseDown = (e) => {
    if (!selectedTool) return;
    
    const rect = overlayCanvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (selectedTool === 'pen') {
      setDrawingMode('pen');
      setCurrentDrawing({
        id: Date.now(),
        type: 'path',
        points: [{ x, y }],
        color,
        trackingEnabled: trackingEnabled,
        trackingStatus: 'active',
        x,
        y
      });
    } else if (selectedTool === 'rectangle') {
      setDrawingMode('rectangle');
      setCurrentDrawing({
        id: Date.now(),
        type: 'rectangle',
        x,
        y,
        width: 0,
        height: 0,
        color,
        trackingEnabled: trackingEnabled,
        trackingStatus: 'active'
      });
    } else if (selectedTool === 'circle') {
      setDrawingMode('circle');
      setCurrentDrawing({
        id: Date.now(),
        type: 'circle',
        x,
        y,
        radius: 0,
        color,
        trackingEnabled: trackingEnabled,
        trackingStatus: 'active'
      });
    }
  };
  
  const handleCanvasMouseMove = (e) => {
    if (!drawingMode || !currentDrawing) return;
    
    const rect = overlayCanvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    if (drawingMode === 'pen') {
      setCurrentDrawing(prev => ({
        ...prev,
        points: [...prev.points, { x, y }]
      }));
    } else if (drawingMode === 'rectangle') {
      setCurrentDrawing(prev => ({
        ...prev,
        width: x - prev.x,
        height: y - prev.y
      }));
    } else if (drawingMode === 'circle') {
      const radius = Math.sqrt((x - currentDrawing.x) ** 2 + (y - currentDrawing.y) ** 2);
      setCurrentDrawing(prev => ({
        ...prev,
        radius
      }));
    }
  };
  
  const handleCanvasMouseUp = () => {
    if (currentDrawing) {
      setAnnotations(prev => [...prev, currentDrawing]);
      
      // Initialize tracking for this annotation
      if (trackingEnabled) {
        setTimeout(() => {
          const trackingData = initializeTracking(currentDrawing);
          if (trackingData) {
            trackingDataRef.current[currentDrawing.id] = trackingData;
          }
        }, 50);
      }
    }
    setDrawingMode(null);
    setCurrentDrawing(null);
  };
  
  const renderAnnotation = (ctx, annotation) => {
    ctx.strokeStyle = annotation.color;
    ctx.fillStyle = annotation.color;
    ctx.lineWidth = 3;
    
    // Add tracking status indicator
    if (annotation.trackingEnabled) {
      if (annotation.trackingStatus === 'lost') {
        ctx.strokeStyle = '#EF4444';
        ctx.setLineDash([5, 5]);
      } else if (annotation.trackingStatus === 'uncertain') {
        ctx.strokeStyle = '#F59E0B';
        ctx.setLineDash([3, 3]);
      } else {
        ctx.strokeStyle = annotation.color;
        ctx.setLineDash([]);
      }
    }
    
    if (annotation.type === 'path') {
      ctx.beginPath();
      ctx.moveTo(annotation.points[0].x, annotation.points[0].y);
      annotation.points.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
    } else if (annotation.type === 'rectangle') {
      ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
    } else if (annotation.type === 'circle') {
      ctx.beginPath();
      ctx.arc(annotation.x, annotation.y, annotation.radius, 0, 2 * Math.PI);
      ctx.stroke();
    }
    
    ctx.setLineDash([]);
  };
  
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    annotations.forEach(annotation => renderAnnotation(ctx, annotation));
    if (currentDrawing) renderAnnotation(ctx, currentDrawing);
  }, [annotations, currentDrawing]);
  
  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };
  
  const reinitializeTracking = () => {
    trackingDataRef.current = {};
    annotations.forEach(annotation => {
      if (annotation.trackingEnabled) {
        const trackingData = initializeTracking(annotation);
        if (trackingData) {
          trackingDataRef.current[annotation.id] = trackingData;
        }
      }
    });
  };

  return (
    <div className="w-full h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Video className="w-6 h-6 text-blue-400" />
            <h1 className="text-xl font-bold">HoloRay Motion-Tracked Annotations</h1>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Users className="w-4 h-4" />
            <span>{connectedUsers} connected</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Tools */}
        <div className="w-64 bg-gray-800 border-r border-gray-700 p-4 overflow-y-auto">
          <div className="space-y-6">
            {/* Video Upload */}
            <div>
              <h3 className="text-sm font-semibold mb-2 text-gray-300">Video Source</h3>
              <label className="block">
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleVideoUpload}
                  className="hidden"
                />
                <div className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded cursor-pointer text-center text-sm">
                  Upload Medical Video
                </div>
              </label>
            </div>

            {/* Drawing Tools */}
            <div>
              <h3 className="text-sm font-semibold mb-2 text-gray-300">Annotation Tools</h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSelectedTool('pen')}
                  className={`p-3 rounded flex flex-col items-center gap-1 ${
                    selectedTool === 'pen' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  <Pencil className="w-5 h-5" />
                  <span className="text-xs">Pen</span>
                </button>
                <button
                  onClick={() => setSelectedTool('rectangle')}
                  className={`p-3 rounded flex flex-col items-center gap-1 ${
                    selectedTool === 'rectangle' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  <Square className="w-5 h-5" />
                  <span className="text-xs">Box</span>
                </button>
                <button
                  onClick={() => setSelectedTool('circle')}
                  className={`p-3 rounded flex flex-col items-center gap-1 ${
                    selectedTool === 'circle' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  <Circle className="w-5 h-5" />
                  <span className="text-xs">Circle</span>
                </button>
              </div>
            </div>

            {/* Color Picker */}
            <div>
              <h3 className="text-sm font-semibold mb-2 text-gray-300">Color</h3>
              <div className="flex gap-2 flex-wrap">
                {['#FF0000', '#00FF00', '#0066FF', '#FFFF00', '#FF00FF', '#00FFFF'].map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-10 h-10 rounded border-2 ${
                      color === c ? 'border-white' : 'border-gray-600'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            {/* Tracking Controls */}
            <div>
              <h3 className="text-sm font-semibold mb-2 text-gray-300">Motion Tracking</h3>
              <button
                onClick={() => setTrackingEnabled(!trackingEnabled)}
                className={`w-full p-3 rounded flex items-center justify-center gap-2 ${
                  trackingEnabled ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                {trackingEnabled ? <Unlock className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
                <span>{trackingEnabled ? 'Tracking Active' : 'Tracking Disabled'}</span>
              </button>
              
              <button
                onClick={reinitializeTracking}
                className="w-full mt-2 p-2 bg-gray-700 hover:bg-gray-600 rounded flex items-center justify-center gap-2 text-sm"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reinitialize</span>
              </button>
            </div>

            {/* Clear */}
            <button
              onClick={() => {
                setAnnotations([]);
                trackingDataRef.current = {};
              }}
              className="w-full p-2 bg-red-600 hover:bg-red-700 rounded flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear All</span>
            </button>

            {/* Status Legend */}
            <div>
              <h3 className="text-sm font-semibold mb-2 text-gray-300">Tracking Status</h3>
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-green-500"></div>
                  <span>Active tracking</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-yellow-500" style={{borderStyle: 'dashed'}}></div>
                  <span>Uncertain</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-red-500" style={{borderStyle: 'dashed'}}></div>
                  <span>Tracking lost</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Video Canvas Area */}
        <div className="flex-1 flex flex-col items-center justify-center bg-black p-4">
          {!videoFile ? (
            <div className="text-center text-gray-400">
              <Video className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg">Upload a medical video to begin</p>
              <p className="text-sm mt-2">Supports ultrasound, echo, laparoscopy, IVUS, and more</p>
            </div>
          ) : (
            <div className="relative max-w-full max-h-full">
              <video
                ref={videoRef}
                src={videoFile}
                className="max-w-full max-h-[70vh]"
                onLoadedMetadata={() => {
                  const canvas = overlayCanvasRef.current;
                  const hiddenCanvas = canvasRef.current;
                  if (canvas && videoRef.current) {
                    canvas.width = videoRef.current.videoWidth;
                    canvas.height = videoRef.current.videoHeight;
                    hiddenCanvas.width = videoRef.current.videoWidth;
                    hiddenCanvas.height = videoRef.current.videoHeight;
                  }
                }}
              />
              <canvas
                ref={overlayCanvasRef}
                className="absolute top-0 left-0 cursor-crosshair"
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
              />
              <canvas ref={canvasRef} className="hidden" />
              
              {/* Video Controls */}
              <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-gray-800 bg-opacity-90 rounded-lg px-4 py-2 flex items-center gap-4">
                <button
                  onClick={togglePlay}
                  className="p-2 bg-blue-600 hover:bg-blue-700 rounded"
                >
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                </button>
                <span className="text-sm">
                  {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MotionTrackedAnnotationSystem;