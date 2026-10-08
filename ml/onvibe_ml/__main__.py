"""CLI: python -m onvibe_ml <command>  (run from the ml/ directory)

  label sample              build a stratified queue of posts to hand-label
  label                     label the queue in the terminal (resumable)
  eval grounding            check every number in synthesized insights against the metrics (free)
  eval classify [--model M] score production (and optionally model M) against hand labels
  eval agreement --model M  label-free: how often model M agrees with production
  kg extract                LLM entity extraction for posts not yet extracted (cached)
  kg build [--persist]      resolve entities, build the whole graph, write ml/reports/kg_summary.md
                            (--persist replaces every graph table in Supabase)
  kg build --analysis ID [--persist] [--json]
                            extract (cached) + build one analysis' graph; --persist upserts only that
                            analysis' rows; --json prints its topic gaps as JSON on stdout
  kg query gaps|collabs|entity  example questions over the graph
"""

import argparse

from .config import default_model


def main() -> None:
    parser = argparse.ArgumentParser(prog="onvibe_ml")
    sub = parser.add_subparsers(dest="group", required=True)

    label = sub.add_parser("label", help="hand-label posts for the classifier eval")
    label.add_argument("action", nargs="?", choices=["sample", "status"])
    label.add_argument("--total", type=int, default=150)
    label.add_argument("--min-per-class", type=int, default=20)

    ev = sub.add_parser("eval", help="run an eval")
    ev.add_argument("which", choices=["grounding", "classify", "agreement"])
    ev.add_argument("--model", action="append", default=[], help="model id to re-run (repeatable)")
    ev.add_argument("--sample", type=int, default=120, help="posts to compare for `agreement`")

    kg = sub.add_parser("kg", help="knowledge graph")
    kg.add_argument("action", choices=["extract", "build", "query"])
    kg.add_argument("query", nargs="?", choices=["gaps", "collabs", "entity"])
    kg.add_argument("--model", default=None)
    kg.add_argument("--analysis", help="limit extraction / gap analysis to one analysis id; with `kg build`, build only that analysis")
    kg.add_argument("--name", help="entity name for `kg query entity`")
    kg.add_argument("--persist", action="store_true", help="also write nodes/edges to Supabase")
    kg.add_argument("--json", action="store_true", help="with `kg build --analysis`, print topic gaps as JSON on stdout")

    args = parser.parse_args()

    if args.group == "label":
        from .evals import labeling

        if args.action == "sample":
            labeling.build_queue(args.total, args.min_per_class)
        elif args.action == "status":
            print(dict(labeling.gold_summary()) or "No labels yet.")
        else:
            labeling.label_interactively()

    elif args.group == "eval":
        if args.which == "grounding":
            from .evals import grounding

            print(grounding.run())
        elif args.which == "classify":
            from .evals import classifier

            print(classifier.run(args.model))
        else:
            from .evals import classifier

            print(classifier.run_agreement(args.model[0] if args.model else default_model(), args.sample))

    elif args.group == "kg":
        from .kg import cli as kg_cli

        kg_cli.run(args)


if __name__ == "__main__":
    main()
