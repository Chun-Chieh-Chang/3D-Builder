# Task Plan: Sprint STABLE-1 (TNS v2 Implementation)

## Goal
Implement Topological Naming Service (TNS) v2 in the backend to ensure feature references (faces/edges) remain stable after model changes.

## Phases

### Phase 1: Research & Fingerprint Definition
- [ ] Read `backend/app/services/geometry_service.py` functions `find_matching_face` and `find_matching_edge`.
- [ ] Define the "Fingerprint" data structure: { normal, centroid, area, type }.
- Status: `not_started`

### Phase 2: Implementation of Fuzzy Matching Logic
- [ ] Upgrade `find_matching_face` to include a "Fuzzy Search" mode.
- [ ] Implement distance-weighted score: $Score = W_1 \cdot \text{dist}(C_1, C_2) + W_2 \cdot \text{angle}(N_1, N_2) + W_3 \cdot |\text{Area}_1 - \text{Area}_2|$.
- [ ] Return the best-matched sub-shape even if the exact Hash/ID changed.
- Status: `not_started`

### Phase 3: Verification
- [ ] Run `backend/tests/e2e_stress_test_sim.py` and ensure the DRAFT and SHELL errors are resolved by the fuzzy matcher.
- Status: `not_started`
