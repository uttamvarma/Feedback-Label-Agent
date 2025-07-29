const config = {
  labelTaxonomy: {
    themes: [
      "Functionality",
      "Workflow", 
      "Stability",
      "Guidance",
      "Provisioning",
      "Compliance"
    ],
    impactLevels: ["High", "Medium", "Low"]
  },
  ai: {
    model: "confluence-ai",
    // Allow different confidence thresholds per impact level
    confidenceThresholds: {
      "High": 0.9,
      "Medium": 0.75,
      "Low": 0.6
    },
    // Fallback used if impact level not found
    defaultThreshold: 0.6
  }
};

export default config;