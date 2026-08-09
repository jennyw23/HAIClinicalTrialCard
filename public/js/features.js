// ── Feature-control wiring (design map + compare selectors) ────────────────
function setupFeatureControls() {
  if (document.getElementById('map-y-select')) {
    fillMapDimensionSelects();

    document.getElementById('map-y-select').addEventListener('change', e => {
      mapState.y = e.target.value;
      mapState.selected = null;
      syncMapDimensionOptions();
      renderDesignMap();
    });
    document.getElementById('map-x-select').addEventListener('change', e => {
      mapState.x = e.target.value;
      mapState.selected = null;
      syncMapDimensionOptions();
      renderDesignMap();
    });
    document.getElementById('map-swap').addEventListener('click', () => {
      [mapState.x, mapState.y] = [mapState.y, mapState.x];
      mapState.selected = null;
      fillMapDimensionSelects();
      renderDesignMap();
    });
  }

  if (document.getElementById('compare-a-select')) {
    document.getElementById('compare-a-select').addEventListener('change', e => {
      compareState.a = e.target.value;
      syncCompareOptions();
      renderComparison();
    });
    document.getElementById('compare-b-select').addEventListener('change', e => {
      compareState.b = e.target.value;
      syncCompareOptions();
      renderComparison();
    });
    document.getElementById('compare-highlight').addEventListener('change', e => {
      compareState.highlight = e.target.checked;
      renderComparison();
    });
    document.getElementById('near-twin-btn').addEventListener('click', selectNearTwin);
  }
}

function refreshFeatureViews() {
  if (document.getElementById('map-y-select')) {
    fillMapDimensionSelects();
    renderDesignMap();
  }
  if (document.getElementById('compare-a-select')) {
    fillCompareSelects();
    renderComparison();
  }
}
