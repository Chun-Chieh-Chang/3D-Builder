# 3D-Builder v1.0.0 Release Notes

> **Release Date**: 2026-05-24
> **Build**: v1.0.0-production
> **Status**: Official GA (General Availability)

---

## 1. Welcome to 3D-Builder 1.0!

3D-Builder 1.0 is a modern, graph-driven CAD application designed for rapid parametric part modeling. Powered by a hybrid solving engine (PBD for interaction, NR for precision) and an industrial OpenCASCADE kernel, it provides professional-grade stability in a lean, desktop-native package.

---

## 2. Key Features

### 2.1 Precision Modeling & Solving
- **Industrial Core**: Full B-Rep modeling powered by OpenCASCADE.
- **Precise Solver**: Integrated Newton-Raphson constraint solver for exact sketch dimensions.
- **Parametric History**: A robust design tree supporting suppression, reordering, and dependency tracking.

### 2.2 Advanced Interoperability
- **Standard Exchange**: Official support for **STEP**, **IGES**, and **STL** export.
- **Smart Import**: Import external STEP files as 'Dumb Solids' to integrate standard parts into your design.
- **Technical Drawing**: Professional 2D Drawing Engine with Hidden Line Removal (HLR) and ISO-compliant styling.

### 2.3 Topological Stability (TNS)
- **Persistent Naming**: Advanced entity tracking that preserves fillets, chamfers, and hole references even when upstream dimensions change.
- **Geometric Signatures**: Multi-attribute matching (Area, Curvature, Topology) for extreme reliability.

### 2.4 User Interface
- **Brand Identity**: Optimized 'Advanced Gray & Brand Blue' theme with native Dark Mode support.
- **Adaptive Performance**: Dynamic tessellation resolution that automatically balances fidelity and frame rate.

---

## 3. Production Stability
- **Verified Metrics**: 100% pass rate on all geometric regression and persistence roundtrip tests.
- **Resource Management**: Explicit WebGL lifecycle control to prevent memory leaks during long modeling sessions.

---
**SolidWeb 3D-Builder Team**  
*Empowering engineers through graph-driven CAD.*
