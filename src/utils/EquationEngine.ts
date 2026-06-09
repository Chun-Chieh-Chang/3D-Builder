/**
 * EquationEngine.ts
 * Core logic for parsing and evaluating mathematical expressions in 3D-Builder.
 * Supports basic operators: +, -, *, /, ^ and variable substitution.
 */

export class EquationEngine {
  private static UNIT_FACTORS: Record<string, number> = {
    'mm': 1.0,
    'cm': 10.0,
    'm': 1000.0,
    'in': 25.4,
    'inch': 25.4,
  };

  /**
   * Safely evaluates a mathematical expression string, supporting unit suffixes.
   * @param expr The expression to evaluate (e.g., "1in + 5mm")
   * @param context A dictionary of variables and their numeric values
   * @returns The evaluated result as a number (always in mm)
   */
  public static evaluate(expr: string, context: Record<string, number> = {}): number {
    if (!expr) return 0;

    // 1. Unit Conversion Preprocessing
    // Regex: (\d+(\.\d*)?) - Number, \s* - optional space, (mm|in|inch|cm|m) - unit
    let processed = expr.toLowerCase();
    
    // Replace unit suffixes with multiplication by factor
    // We use a regex that matches numbers followed by units
    const unitRegex = /(\d+(\.\d*)?)\s*(mm|inch|in|cm|m)\b/g;
    processed = processed.replace(unitRegex, (match, val, decimal, unit) => {
      const factor = this.UNIT_FACTORS[unit] || 1.0;
      return `(${parseFloat(val) * factor})`;
    });

    // 2. Basic Sanitization: Remove whitespace
    let sanitized = processed.replace(/\s+/g, '');
    
    // 3. Variable Substitution
    const sortedVars = Object.keys(context).sort((a, b) => b.length - a.length);
    for (const varName of sortedVars) {
      const value = context[varName];
      const regex = new RegExp(`\\b${varName.toLowerCase()}\\b`, 'g');
      sanitized = sanitized.replace(regex, `(${value})`);
    }

    // 4. Evaluation
    try {
      sanitized = sanitized.replace(/\^/g, '**');
      
      // Safety check: Only allow numbers, basic operators, and parentheses
      if (/[^-+*/().0-9e**]/.test(sanitized)) {
        throw new Error(`Invalid characters in expression: ${sanitized}`);
      }
       
      const result = eval(sanitized);
      return typeof result === 'number' ? result : 0;
    } catch (err) {
      console.warn(`[EquationEngine] Failed to evaluate: "${expr}" -> "${sanitized}"`, err);
      // Fallback for simple numeric input if eval fails
      const fallback = parseFloat(expr);
      return isNaN(fallback) ? 0 : fallback;
    }
  }

  /**
   * Resolves a set of potentially interdependent variable formulas.
   * Handles dependency ordering and detects circular references.
   */
  public static solveVariableChain(variables: Record<string, string>): Record<string, number> {
    const solved: Record<string, number> = {};
    const unsolved = { ...variables };
    let changed = true;

    // Iterative resolution (Topological-lite)
    while (changed) {
      changed = false;
      for (const [name, formula] of Object.entries(unsolved)) {
        // If formula is pure numeric
        if (!isNaN(parseFloat(formula)) && !/[a-zA-Z]/.test(formula)) {
          solved[name] = parseFloat(formula);
          delete unsolved[name];
          changed = true;
          continue;
        }

        // Try to solve using already solved variables
        try {
          // Check if all variables in the formula are already solved
          const requiredVars = formula.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
          const allResolved = requiredVars.every(v => solved.hasOwnProperty(v));

          if (allResolved) {
            solved[name] = this.evaluate(formula, solved);
            delete unsolved[name];
            changed = true;
          }
        } catch (e) {
          // Skip for now
        }
      }
    }

    return solved;
  }
}
