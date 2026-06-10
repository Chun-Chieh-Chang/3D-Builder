# Feature Gap Audit Report: UI Customization & Ribbon Personalization

## 1. Context & Source
**Video**: SolidWorks Tutorial: Adding Frequently Used Tool Buttons (Video ID: ZyiKXApdvZs)
**Focus**: "Customize UI" (自訂介面). The ability to add, remove, and reorder buttons on the CommandManager (Ribbon) and Shortcut Bars (S-key menu).

## 2. Analysis of the Gap
- **UI (`RibbonController.tsx`)**: The Ribbon buttons are hardcoded in the TSX. There is no dynamic rendering based on user preference.
- **Interaction**: There is no "Right-click -> Customize" handler for the ribbon area.
- **State**: The `useCadStore.ts` does not have a persistent state for "enabledButtons" or "ribbonLayout".
- **Functionality**: Users cannot add specialized buttons (e.g., "Normal To", "Section View") to their main ribbon if they are not already there.

## 3. Recommended Corrective Action (PDCA - Plan)
### Store Update (`src/store/useCadStore.ts`):
- Add a `ribbonConfig` object to the state, storing the list of visible button IDs for each tab (Features, Sketch, Evaluate).
- Persist this config in `localStorage` via Zustand's persist middleware.

### UI Update (`src/ui/RibbonBar/RibbonController.tsx`):
- Refactor the Ribbon to map over the `ribbonConfig` instead of hardcoded JSX blocks.
- Implement a simple "Customize Mode" (activated via right-click).
- In Customize mode, show a "Command Palette" modal containing all available tool icons.
- Support adding buttons to the Ribbon via the modal.

### UI Update (`src/ui/ShortcutBox.tsx`):
- Ensure the S-key menu is also driven by a customizable config.

## 4. Priority
- **Status**: Medium. Highly important for user productivity and professional "feel", but doesn't block core geometry creation.
