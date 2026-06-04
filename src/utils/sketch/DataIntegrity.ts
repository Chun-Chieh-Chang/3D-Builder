export const isValidNumber = (val: any): boolean => {
  return typeof val === 'number' && !isNaN(val) && isFinite(val);
};

export const isValidPoint = (u: any, v: any): boolean => {
  return isValidNumber(u) && isValidNumber(v);
};

export const requireValidPoint = (u: any, v: any, context: string = 'Point') => {
  if (!isValidPoint(u, v)) {
    console.error(`[DataIntegrity] Invalid coordinates detected in ${context}: (${u}, ${v})`);
    return false;
  }
  return true;
};
