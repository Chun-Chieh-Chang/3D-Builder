'use client';

import React, { useEffect } from 'react';
import { useCadStore } from '../store/useCadStore';

export const RobotOperationService: React.FC = () => {
  const { 
    addAutomationLog, 
    setActiveAutomationStep, 
    setRobotStatus,
    robotStatus,
    activeAutomationStep
  } = useCadStore();

  useEffect(() => {
    // Listen for custom robot events sent via window
    const handleRobotEvent = (e: any) => {
      const { type, payload } = e.detail;
      
      if (type === 'START_MODELING') {
        setRobotStatus('WORKING');
        addAutomationLog(`Starting Modeling Plan: ${payload.name}`);
      } else if (type === 'STEP_START') {
        setActiveAutomationStep(payload.step);
        addAutomationLog(`>>> Executing: ${payload.step}`);
        
        // Highlight UI element if selector provided
        if (payload.selector) {
          const el = document.querySelector(payload.selector);
          if (el) {
            el.classList.add('robot-highlight');
            setTimeout(() => el.classList.remove('robot-highlight'), 2000);
          }
        }
      } else if (type === 'STEP_SUCCESS') {
        addAutomationLog(`✓ Success: ${payload.step}`);
      } else if (type === 'STEP_ERROR') {
        setRobotStatus('ERROR');
        addAutomationLog(`❌ Error: ${payload.error}`);
      } else if (type === 'FINISH') {
        setRobotStatus('IDLE');
        setActiveAutomationStep('Mission Accomplished 🎓');
        addAutomationLog('All modeling steps completed successfully.');
      }
    };

    window.addEventListener('robot-op', handleRobotEvent);
    return () => window.removeEventListener('robot-op', handleRobotEvent);
  }, [addAutomationLog, setActiveAutomationStep, setRobotStatus]);

  return (
    <style jsx global>{`
      .robot-highlight {
        outline: 4px solid #F59E0B !important;
        outline-offset: 2px;
        box-shadow: 0 0 20px #F59E0B !important;
        animation: robot-pulse 1s infinite alternate;
        z-index: 9999;
      }
      @keyframes robot-pulse {
        from { transform: scale(1); }
        to { transform: scale(1.05); }
      }
    `}</style>
  );
};
