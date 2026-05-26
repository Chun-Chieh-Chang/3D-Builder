# Premium UI Design System: Sea Salt Blue & Glass Order

The visual layout of **3D-Builder** is designed around a curated, monochromatic **Refreshing Sea Salt Blue** color master palette, following the strict "Glass Order" design system guidelines.

---

## 1. Refreshing Sea Salt Blue Design Tokens

The styling strictly avoids raw, high-saturation browser defaults. Instead, it utilizes fine-tuned "premium grays" and brand tones:

| UI Element | Light Mode | Dark Mode | Usage & Psychological Intent |
| :--- | :--- | :--- | :--- |
| **Background (Base)** | `#F0F7FB` | `#0F172A` | Clean base surface that minimizes eye strain during extended work sessions. |
| **Surface (Card/Nav)** | `#FFFFFF` | `#1E293B` | High-fidelity cards that lift parameters and Feature trees into their own layers. |
| **Primary Text** | `#1A3A5F` | `#F1F5F9` | Deep marine blue (light) and pure slate (dark) for peak readability. |
| **Secondary Text** | `#5A7D9A` | `#94A3B8` | Subdued tones for secondary specs, unit marks, and descriptions. |
| **Accent/Brand** | `#3A7CA8` | `#60A5FA` | CTA elements, active selections, and major CAD control inputs. |
| **Success/Safe** | `#10B981` | `#34D399` | Feature rebuild success indicators and parent features in tree. |
| **Warning/Error** | `#EF4444` | `#F87171` | Invalid sketch loops, constraint unsolvability warnings, or alert popups. |
| **Border/Divider** | `#B4D8E7` | `#334155` | Whispering, ultra-light grid lines to keep the workspace clean. |

---

## 2. The Glass Order Paradigm

All overlay cards, HUD menus, and dialogs are styled with **Glassmorphism**:

1.  **Backdrop Blur**: Every glass surface must declare `backdrop-filter: blur(16px)` with variable background opacity (usually `0.7` to `0.85`).
2.  **3-Layer Edge Rule**: Glass cards must have:
    -   An outer `1px solid rgba(255,255,255,0.1)` (dark mode) or `rgba(0,0,0,0.05)` (light mode) boundary line.
    -   An inner border-glow (e.g. `box-shadow: inset 0 1px 0 rgba(255,255,255,0.1)`).
    -   A subtle drop-shadow to separate layers.
3.  **Vibrancy (Saturation)**: Use `saturate(180%)` to ensure that content passing underneath retains its colors without looking muddy.

---

## 3. High Contrast & Spatial Gridding

-   **Contrast Guardrails**: A minimum contrast ratio of $4.5:1$ is maintained on transparent overlays by adjusting local font weights (`font-semibold` or `font-bold`) and background opacity dynamically.
-   **8px Gridding Scale**: Padding and margin sizes must strictly use multiples of 4px/8px (e.g., `p-4` or `gap-2`). Arbitrary pixel values are prohibited.
