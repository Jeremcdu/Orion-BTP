// Original canvas handlers from upstream 158003d75376a33fc277f96f729c1b8cfce4c242.
    let isPanning = false;
    let panStart = { x: 0, y: 0 };
    const activeCanvas = document.getElementById('activeCanvas');

    activeCanvas.addEventListener('mousedown', (e) => {
      if (state.activeTool === 'select') {
        isPanning = true;
        panStart = { x: e.clientX - state.pan.x, y: e.clientY - state.pan.y };
        activeCanvas.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (isPanning && state.activeTool === 'select') {
        state.pan = { x: e.clientX - panStart.x, y: e.clientY - panStart.y };
        updateCanvasTransform();
      }
    });

    window.addEventListener('mouseup', () => {
      if (isPanning) {
        isPanning = false;
        if (state.activeTool === 'select') activeCanvas.style.cursor = 'grab';
      }
    });

    activeCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const newZoom = Math.min(5, Math.max(0.3, state.zoom * zoomFactor));
      
      const rect = activeCanvas.getBoundingClientRect();
      const mouseX = e.clientX - (rect.left + rect.width / 2);
      const mouseY = e.clientY - (rect.top + rect.height / 2);
      
      state.pan.x -= (mouseX - state.pan.x) * (newZoom / state.zoom - 1);
      state.pan.y -= (mouseY - state.pan.y) * (newZoom / state.zoom - 1);
      state.zoom = newZoom;
      updateCanvasTransform();
    }, { passive: false });

    // PLACER UN REPERE
