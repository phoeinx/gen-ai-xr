function getColor(rate) {
  return rate > 0.5 ? '#67001f' :
         rate > 0.4 ? '#b2182b' :
         rate > 0.3 ? '#d6604d' :
         rate > 0.2 ? '#f4a582' :
         rate > 0.1 ? '#fddbc7' :
                      '#f7f7f7';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getColor };
}

if (typeof window !== 'undefined') {
  window.getColor = getColor;
}
