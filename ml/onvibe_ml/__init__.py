"""Python ML layer for the OnVibe competitive analysis pipeline.

Reads the same Supabase tables the TypeScript worker writes, and adds:
  - evals/  : classifier accuracy + calibration, and a grounding check on synthesized insights
  - kg/     : a knowledge graph built from scraped posts (entities, relations, resolution)
"""
