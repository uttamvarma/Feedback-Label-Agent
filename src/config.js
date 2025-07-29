const config = {
  labelTaxonomy: {
    themes: [
      "Feature Request",
      "Bug Report", 
      "Usability",
      "Performance",
      "Integration",
      "Other"
    ],
    impactLevels: ["High", "Medium", "Low"]
  },
  ai: {
    model: "confluence-ai",
    // Allow different confidence thresholds per impact level
    confidenceThresholds: {
      "High": 0.8,
      "Medium": 0.7,
      "Low": 0.6
    },
    // Fallback used if impact level not found
    defaultThreshold: 0.7
  }
};

export default config;