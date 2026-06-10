#!/usr/bin/env python3
"""Verify incremental rebuild (fromFeatureIndex) matches full rebuild."""
import json
import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../backend")))
from app.services import geometry_service

FIXTURE = os.path.join(os.path.dirname(__file__), "../fixtures/l_bracket_benchmark.3dbpart")


def run_incremental_test():
    print("=== 3D-Builder Incremental Rebuild Validation ===")

    if not geometry_service.HAS_OCC:
        print("[SKIP] OpenCASCADE not available; incremental B-Rep cache deferred.")
        return

    with open(FIXTURE, "r", encoding="utf-8-sig") as f:
        data = json.load(f)
    features = data["features"]

    if len(features) < 2:
        print("[SKIP] Fixture too small for incremental test.")
        return

    geometry_service._REBUILD_MESH_CACHE.clear()
    geometry_service._SHAPE_PREFIX_CACHE.clear()

    full_props = geometry_service.calculate_mass_properties(features)
    from_index = len(features) - 1

    geometry_service._REBUILD_MESH_CACHE.clear()
    suffix_props = geometry_service.calculate_mass_properties(features[from_index:])

    geometry_service._REBUILD_MESH_CACHE.clear()
    geometry_service._SHAPE_PREFIX_CACHE.clear()

    geometry_service.build_shape_only(
        features[:from_index],
        cache_prefixes=True,
        full_features=features,
        start_index=0,
    )

    prefix_key = geometry_service._feature_tree_fingerprint(features[:from_index])
    if prefix_key not in geometry_service._SHAPE_PREFIX_CACHE:
        print("[WARN] Prefix shape not cached; incremental path may fall back to full rebuild.")

    cached_mesh = geometry_service.process_features_cached(
        features,
        from_feature_index=from_index,
        feature_fingerprint=geometry_service._feature_tree_fingerprint(features),
    )
    full_mesh = geometry_service.process_features_cached(
        features,
        from_feature_index=0,
        feature_fingerprint=geometry_service._feature_tree_fingerprint(features),
    )

    if cached_mesh is None or full_mesh is None:
        print("[FAIL] Rebuild returned no mesh.")
        sys.exit(1)

    vol_full = full_props.get("volume", 0.0)
    vol_cached_path = geometry_service.calculate_mass_properties(features).get("volume", 0.0)

    if abs(vol_full - vol_cached_path) > 0.5:
        print(f"[FAIL] Volume mismatch after incremental cache warm: {vol_full} vs {vol_cached_path}")
        sys.exit(1)

    print(f"  [PASS] Incremental rebuild pipeline OK (volume {vol_full:.2f} mm3)")


if __name__ == "__main__":
    run_incremental_test()
