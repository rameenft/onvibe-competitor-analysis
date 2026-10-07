# Knowledge graph summary

Built from 732 unique posts (869 post rows; the same post scraped in two analyses is one node), 732 with LLM extractions.

| Node type | Count |  | Edge type | Count |
| --- | --- | --- | --- | --- |
| post | 732 |  | TAGGED | 1728 |
| hashtag | 556 |  | MENTIONS | 1628 |
| topic | 454 |  | ABOUT | 1586 |
| person | 243 |  | POSTED | 732 |
| account | 242 |  | IN_CATEGORY | 732 |
| product | 177 |  | PART_OF | 200 |
| organization | 156 |  | MADE_BY | 153 |
| campaign | 98 |  | COLLABORATED_WITH | 120 |
| company | 12 |  | OPERATES | 12 |
| category | 7 |  | COMPETES_WITH | 12 |

## Extraction quality

- Grounding guardrail: 1355 entities kept, 68 dropped (4.8%) because their quoted evidence wasn't in the caption.
- Topic canonicalization merged 47 labels into 23 canonical topics (479 raw labels -> 454 topic nodes).
- Entity resolution merges (unique surface forms): 17 by normalize, 14 by fuzzy, 12 by account-match.
- Organizations resolved to tracked accounts: "@stanforcreators" -> Stan; "CleanMyPhone" -> CleanMy®Phone; "CleanMy®Phone" -> CleanMy®Phone; "NASA" -> NASA; "Nat Geo" -> National Geographic; "National Geographic" -> National Geographic; "OnVibe" -> OnVibe; "Predis.ai" -> Predis.ai; "Smart Transfer" -> Smart Transfer; "SpaceX" -> SpaceX; "Stan" -> Stan; "Wondershare" -> Wondershare

## Most connected entities

- **topic**: space exploration (127), wildlife photography (41), wildlife conservation (41), creator economy (39), astronomy (36), content strategy (29), content creation (29), social media marketing (27)
- **organization**: Disney (42), Hulu (25), Samsung (22), Apple (21), Google (8), Instagram (6), Getty Images (6), ESA (6)
- **product**: Falcon 9 (35), Smart Transfer (33), iPhone (26), Disney+ (26), Starlink (23), Stanley (21), Hulu (21), Predis.ai (20)
- **person**: Joel Sartore (18), Bertie Gregory (10), Tom Hiddleston (6), Otto Whitehead (5), Keith Ladzinski (5), Arzucan Askin (5), Antoni Porowski (5), Chris Williams (4)
- **campaign**: Artemis II (22), Photo Ark (15), Sharkfest (8), Photos of the Day (8), Disney Celebrates America (8), Hammerhead Sharks Up Close (7), Wonders of America (5), World Cup (4)

## Example: shared collaborators

```
Entities featured by 2+ tracked accounts:
  Andre Douglas [person] <- @nasa, @natgeo
  Canadian Space Agency [organization] <- @nasa, @natgeo
  Christina Koch [person] <- @nasa, @natgeo
  Disney [organization] <- @natgeo, @stanforcreators
  Frank Rubio [person] <- @nasa, @natgeo
  Instagram [organization] <- @onvibe.co, @wondershare_dr.fone
  International Space Station [organization] <- @nasa, @spacex
  Jeremy Hansen [person] <- @nasa, @natgeo
  Luca Parmitano [person] <- @nasa, @natgeo
  Randy Bresnik [person] <- @nasa, @natgeo
  Reid Wiseman [person] <- @nasa, @natgeo
  SpaceX [company] <- @nasa, @natgeo
  Victor Glover [person] <- @nasa, @natgeo
```
