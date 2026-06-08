'use client';

import React, { useState } from 'react';

interface TabProps {
  label: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}

interface TabsProps {
  children: React.ReactElement<TabProps>[];
  defaultIndex?: number;
}

export const Tab: React.FC<TabProps> = ({ children }) => {
  return <>{children}</>;
};

export const Tabs: React.FC<TabsProps> = ({ children, defaultIndex = 0 }) => {
  const [activeIndex, setActiveIndex] = useState(defaultIndex);

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-slate-200 bg-slate-50">
        {React.Children.map(children, (child, index) => {
          if (!React.isValidElement(child)) return null;
          const isActive = index === activeIndex;
          return (
            <button
              onClick={() => setActiveIndex(index)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-[11px] font-bold uppercase tracking-tighter transition-all outline-none
                ${isActive 
                  ? 'bg-white text-blue-600 border-b-2 border-blue-600 shadow-sm' 
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
            >
              {child.props.icon && <span>{child.props.icon}</span>}
              {child.props.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 p-2 bg-white">
        {React.Children.toArray(children)[activeIndex]}
      </div>
    </div>
  );
};
