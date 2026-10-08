# Classifier eval

Gold set: 156 hand-labeled posts (see `ml/data/labeling_guide.md`). Overall numbers are reweighted by sampling stratum, so they estimate performance on the full post population; the confusion matrix shows raw counts.

## Summary

| Source | Accuracy | Macro-F1 | ECE (calibration error) | Agreement with production (kappa) | Cost |
| --- | --- | --- | --- | --- | --- |
| production | 57.0% | 0.460 | 0.253 | - | - |
| gemini-3.8-flash | 65.7% | 0.525 | 0.259 | 64.1% (0.56) | 4 calls, 25,709 in / 54,191 out tokens, $0.222 |

## Tuning set vs locked holdout

The holdout labels were not looked at while the prompt was edited, so it is the honest number.

| Source | Tuning accuracy | n | Holdout accuracy | n |
| --- | --- | --- | --- | --- |
| production | 60.1% | 106 | 50.1% | 50 |
| gemini-3.8-flash | 69.5% | 106 | 57.3% | 50 |

## Production self-consistency (no labels needed)

137 posts were scraped in two analyses and classified independently each time. The two runs agreed on 93.4% of them (kappa 0.90).
Most common splits: collaboration / product (2), campaign / product (2), campaign / collaboration (1), collaboration / paid_promotion (1), collaboration / testimonial (1).

## production

| Category | Precision | Recall | F1 | Gold support (weighted) |
| --- | --- | --- | --- | --- |
| collaboration | 20.0% | 7.8% | 0.112 | 61.9 |
| campaign | 26.3% | 64.5% | 0.374 | 48.1 |
| paid_promotion | 70.0% | 17.7% | 0.283 | 67.1 |
| product | 52.9% | 69.5% | 0.601 | 159.9 |
| testimonial | 60.0% | 100.0% | 0.750 | 13.8 |
| educational | 73.3% | 82.4% | 0.776 | 265.1 |
| other | 61.1% | 22.1% | 0.325 | 116.0 |

Confusion matrix (rows = gold, columns = predicted, raw counts):

| gold \ pred | collab | campai | paid_p | produc | testim | educat | other |
| --- | --- | --- | --- | --- | --- | --- | --- |
| collaboration | 3 | 4 | 0 | 1 | 1 | 3 | 2 |
| campaign | 2 | 5 | 0 | 2 | 1 | 0 | 0 |
| paid_promotion | 5 | 4 | 7 | 3 | 1 | 0 | 1 |
| product | 2 | 2 | 3 | 18 | 1 | 4 | 0 |
| testimonial | 0 | 0 | 0 | 0 | 9 | 0 | 0 |
| educational | 2 | 2 | 0 | 3 | 2 | 33 | 4 |
| other | 1 | 2 | 0 | 7 | 0 | 5 | 11 |

Calibration (does stated confidence match observed accuracy?):

| Confidence bin | Mean confidence | Accuracy | Posts |
| --- | --- | --- | --- |
| 0.5-0.6 | 0.60 | 43.2% | 10 |
| 0.6-0.7 | 0.70 | 54.1% | 14 |
| 0.7-0.8 | 0.78 | 57.9% | 47 |
| 0.8-0.9 | 0.87 | 56.6% | 77 |
| 0.9-1.0 | 0.95 | 71.3% | 8 |

If we only trusted predictions above a confidence threshold:

| Threshold | Coverage | Accuracy |
| --- | --- | --- |
| >= 0.5 | 100.0% | 57.0% |
| >= 0.7 | 95.8% | 57.6% |
| >= 0.8 | 75.4% | 56.6% |
| >= 0.9 | 24.7% | 48.9% |

<details><summary>70 misclassified posts</summary>

| post_id | gold | predicted | model's rationale |
| --- | --- | --- | --- |
| `07d9e2d0` | campaign | testimonial | Showcases a creator's growth milestone as proof of the platform's value. |
| `2a2fa056` | paid_promotion | product | Promotes AI video ad automation feature. |
| `858a4f86` | educational | product | Describes a Falcon 9 Starlink satellite launch mission. |
| `03f3ef59` | other | product | Describes a Falcon 9 Starlink launch, a routine product/mission update. |
| `39543804` | collaboration | educational | Explains multiple telescope images while tying them to a patriotic theme, primarily educational content. |
| `41cabf42` | paid_promotion | collaboration | Describes the Okavango Eternal partnership between De Beers Group and National Geographic supporting young storytellers. |
| `b30b3fa8` | other | product | Describes a Falcon 9 Starlink satellite launch mission. |
| `5ac1bc78` | educational | other | A reflective, lifestyle-oriented post using a Moon photo, not clearly educational or promotional. |
| `96d28143` | product | collaboration | Coauthor tag with personal recommendation style content about WeLastseen app, indicating influencer collaboration. |
| `06b2e27d` | collaboration | campaign | Promotes a specific show premiere (DWTS Next Pro) with a tagged celebrity, indicating a network cross-promotion campaign rather than paid sponsorship. |
| `1d0b9b53` | educational | campaign | Shares an Artemis II mission moment as part of ongoing Artemis campaign content. |
| `c720f534` | educational | collaboration | Features footage credited to University of Arizona Wild Cat Research & Conservation Center, indicating an institutional research partnership. |
| `e0c9eb77` | other | educational | Recaps an educational workshop session on AI and marketing led by named speakers in partnership with SBDC Nevada. |
| `5ee771ac` | educational | other | Recaps a spacewalk event with fun facts, more of a mission highlight than clear educational content. |
| `6fabffdc` | product | collaboration | Coauthor tag with casual personal endorsement of WeLastseen app, consistent with influencer collaboration style. |
| `0ccdf751` | paid_promotion | campaign | Promotes Pompeii: Out of Time series content featuring Tom Hiddleston. |
| `feaee517` | campaign | collaboration | Short event promo for the Small Business Week founder panel, part of the collaborative San Francisco event series. |
| `8c9753a8` | product | campaign | World Cup themed promotional post for MobileTrans backup feature. |
| `3a9589e2` | product | paid_promotion | Explicitly tagged with #Ad and #Collaboration hashtags confirming sponsored content. |
| `9995fed6` | campaign | product | Announces the opening of the new National Geographic Museum of Exploration. |
| `a17ea7a1` | educational | product | Promotes streaming of a specific Nat Geo show (#DrainTheOceans) on Disney+. |
| `77837fea` | product | paid_promotion | Personal-style endorsement of MobileTrans by tagged creator with product link, suggesting sponsored promotion. |
| `36098e29` | paid_promotion | collaboration | Explicit institutional partnership between National Geographic and NASA for Artemis II mission content. |
| `8a4b9dcd` | paid_promotion | collaboration | Features an interview-style collaboration with Toy Story 5 filmmakers via the Behind the Shot series. |
| `6ea7f294` | other | educational | Astronaut shares an Earth observation photo with geographic and scientific context. |
| `10bbe25e` | paid_promotion | campaign | Engagement post promoting the Sharkfest series streaming premiere. |
| `5e342f4f` | other | campaign | Celebrates America250 and Artemis legacy as part of a themed promotional campaign. |
| `b898bca5` | paid_promotion | collaboration | Promotes a film premiere from filmmakers in partnership with IMAX, reflecting institutional collaboration rather than paid ad. |
| `dbf6fadf` | other | product | Promotes streaming of #SecretsOfThePenguins on Disney+ and Hulu. |
| `98eabdc5` | educational | product | Describes a Falcon 9 CRS mission to the ISS. |
| `186d3d18` | product | educational | Explains algorithm signal concepts before linking to the OnVibe product. |
| `3bab6f42` | other | educational | Shares a storytelling photography moment from the National Geographic archive. |
| `92d73c54` | other | product | Promotes Backup & Restore feature of the app. |
| `5bec325d` | product | paid_promotion | Explicit 'In partnership with National Geographic' disclosure alongside promotion of Antoni's new show clearly signals sponsored content. |
| `1cd95442` | paid_promotion | product | Describes the liftoff of Starship's thirteenth flight test, a product milestone. |
| `243193ca` | paid_promotion | collaboration | Highlights the Rolex National Geographic Explorer of the Year award, an institutional partnership between Rolex and National Geographic Society. |
| `c4a72e3d` | educational | testimonial | Describes example success stories of businesses using social media strategies. |
| `363bb583` | collaboration | testimonial | Features a founder sharing her brand-building story as an inspirational testimonial, tagging her business handles. |
| `ca855d4b` | other | collaboration | Nasdaq post celebrating NASA Artemis II crew's institutional visit, not a paid sponsorship. |
| `c8b7610c` | educational | collaboration | Highlights research findings from a named multidisciplinary research initiative (Project CETI) without sponsorship language, indicating institutional partnership. |
| `c2ec0abe` | campaign | collaboration | Explicitly states the event was 'arranged in collaboration with' Yes SF and the SF Chamber of Commerce, tagging partner organizations and founders as genuine institutional partnership. |
| `6ec46938` | paid_promotion | campaign | Promotes the #PompeiiOutOfTime series streaming on Disney+ and Hulu featuring Tom Hiddleston. |
| `4814b483` | product | campaign | World Cup themed engagement post tied to MobileTrans branding, part of broader campaign. |
| `3689852b` | other | campaign | Promotional messaging framing Artemis II as part of a larger mission campaign narrative. |
| `4d09f8fd` | other | product | Describes a Falcon 9 Starlink satellite launch mission. |
| `64688e4b` | educational | other | Promotes Nat Geo's own 'Best of the World 2026' travel list, a branded content roundup rather than campaign or collaboration. |
| `3fceb411` | other | educational | Informative content about a newly discovered octopus species with no promotional intent. |
| `dceb1ec6` | other | product | Describes a Falcon 9 Starlink satellite launch mission. |
| `e0d7fda8` | educational | other | A scenic travel photo feature without an explicit campaign or product tie-in. |
| `d5cf5338` | other | educational | Explains elephants' evolutionary connection to water and climate vulnerability. |
| `4907511f` | collaboration | campaign | Promotes The Mandalorian and Grogu movie and National Geographic's Lion, a cross-promotional campaign. |
| `bff278ed` | collaboration | campaign | Part of the branded 'Wonders of America' 250th anniversary campaign series. |
| `77104354` | collaboration | campaign | Promotes National Geographic's #EarthMonth collection on Disney+ featuring explorer Joel Sartore. |
| `28dae4f3` | paid_promotion | testimonial | Creator/coach recommends Stan platform based on personal and student experience with new features, functioning as testimonial endorsement rather than disclosed ad. |
| `a7066402` | paid_promotion | campaign | Promotes the Hammerhead Sharks Up Close special as part of Sharkfest on Disney+/Hulu. |
| `7af0c948` | collaboration | educational | Informative content about gray whale strandings and new detection technology, no promotional intent. |
| `47442e9c` | paid_promotion | product | Founder describing personal use and features of the Stanley AI content tool with waitlist CTA. |
| `03b18270` | product | testimonial | Personal account of recovering deleted WhatsApp data using Dr.Fone, testimonial style. |
| `8e3fdbda` | collaboration | other | A brief personal update from an astronaut about safety and an aurora sighting on ISS, not clearly categorized elsewhere. |
| `c05190c1` | paid_promotion | other | Short appreciation message with no product, campaign, or partnership content. |
| `610a61a7` | other | product | Describes a Falcon 9 Starlink satellite launch mission. |
| `237fccb8` | collaboration | other | Short casual post tagging GaryVee with no clear promotional intent. |
| `5a87352e` | educational | campaign | Promotes #ARealBugsLife streaming on Disney+. |
| `6683bebf` | educational | testimonial | First-person account describing how consistent branding transformed their presence. |
| `93e71324` | product | educational | Describes the Westerlund 2 star cluster using combined telescope imagery. |
| `20271d42` | product | educational | Provides advice on improving ROAS with a product mention embedded in educational framing. |
| `bb7c258a` | collaboration | product | Promotes the upcoming show #PompeiiOutOfTime with Tom Hiddleston on Disney+/Hulu. |
| `171c01a0` | product | educational | Simple tip about disabling full-screen screenshot previews on iPhone. |
| `ea6b6037` | campaign | product | Announces new Stan Store feature updates with a free access offer. |
| `b7845ce5` | collaboration | educational | Informative news update about NASA's Artemis III crew selection with no promotional intent. |

</details>

## gemini-3.8-flash

| Category | Precision | Recall | F1 | Gold support (weighted) |
| --- | --- | --- | --- | --- |
| collaboration | 27.9% | 26.4% | 0.271 | 61.9 |
| campaign | 37.0% | 84.0% | 0.514 | 48.1 |
| paid_promotion | 85.7% | 15.2% | 0.258 | 67.1 |
| product | 79.7% | 77.0% | 0.784 | 159.9 |
| testimonial | 57.1% | 44.4% | 0.500 | 13.8 |
| educational | 78.0% | 86.5% | 0.821 | 265.1 |
| other | 59.2% | 47.4% | 0.527 | 116.0 |

Confusion matrix (rows = gold, columns = predicted, raw counts):

| gold \ pred | collab | campai | paid_p | produc | testim | educat | other |
| --- | --- | --- | --- | --- | --- | --- | --- |
| collaboration | 4 | 4 | 0 | 0 | 0 | 5 | 1 |
| campaign | 1 | 8 | 0 | 1 | 0 | 0 | 0 |
| paid_promotion | 6 | 4 | 6 | 2 | 1 | 0 | 2 |
| product | 1 | 1 | 1 | 22 | 1 | 2 | 2 |
| testimonial | 3 | 1 | 0 | 0 | 4 | 1 | 0 |
| educational | 0 | 2 | 0 | 1 | 1 | 39 | 3 |
| other | 3 | 2 | 0 | 1 | 0 | 6 | 14 |

Calibration (does stated confidence match observed accuracy?):

| Confidence bin | Mean confidence | Accuracy | Posts |
| --- | --- | --- | --- |
| 0.7-0.8 | 0.80 | 69.5% | 7 |
| 0.8-0.9 | 0.88 | 57.5% | 65 |
| 0.9-1.0 | 0.95 | 71.0% | 84 |

If we only trusted predictions above a confidence threshold:

| Threshold | Coverage | Accuracy |
| --- | --- | --- |
| >= 0.5 | 100.0% | 65.7% |
| >= 0.7 | 100.0% | 65.7% |
| >= 0.8 | 100.0% | 65.7% |
| >= 0.9 | 79.8% | 68.3% |

<details><summary>59 misclassified posts</summary>

| post_id | gold | predicted | model's rationale |
| --- | --- | --- | --- |
| `07d9e2d0` | campaign | collaboration | It is an unpaid co-authored creator spotlight celebrating @homewithatwist's follower milestone. |
| `2a2fa056` | paid_promotion | product | It promotes Predis.ai's automated video ad generation features and capabilities. |
| `858a4f86` | educational | other | It is a brief one-line status announcement of a rocket launch milestone. |
| `39543804` | collaboration | educational | It teaches scientific facts and details about four distinct astronomical objects captured by space telescopes. |
| `41cabf42` | paid_promotion | collaboration | It highlights an institutional storytelling partnership between National Geographic and De Beers Group. |
| `5ac1bc78` | educational | other | It is a culture and mindfulness post encouraging followers to pause and reflect. |
| `71cb88f3` | testimonial | collaboration | It is an unpaid community creator spotlight co-authored with @ashley.laurren. |
| `f6dac2db` | other | educational | It shares geographical and nature facts about the remote Wakhan corridor in Afghanistan. |
| `06b2e27d` | collaboration | campaign | It is a time-bound tune-in push for an episode of Dancing with the Stars airing tonight. |
| `5c4ff7eb` | paid_promotion | campaign | It promotes the streaming release of a named show series using a dedicated hashtag. |
| `b1898f76` | testimonial | collaboration | It is an unpaid creator spotlight co-authored with @peteycreates to highlight his growth. |
| `3182bb9a` | collaboration | educational | It explains the physics and sports engineering experiments conducted with soccer balls aboard the ISS. |
| `e0c9eb77` | other | collaboration | It highlights a joint workshop and institutional partnership between OnVibe and SBDC Nevada. |
| `0ccdf751` | paid_promotion | collaboration | It is an unpaid co-authored post featuring Tom Hiddleston to promote his lecture and series. |
| `119cf205` | product | campaign | It is a time-bound holiday marketing post specifically tied to Father's Day. |
| `3a9589e2` | product | paid_promotion | Explicitly discloses sponsorship with the #Ad hashtag. |
| `69df5002` | other | collaboration | Features and spotlights guest photographer @reuben without any sponsorship signals. |
| `36098e29` | paid_promotion | collaboration | Highlights an unpaid institutional partnership and shared content between Nat Geo and NASA. |
| `8a4b9dcd` | paid_promotion | collaboration | Co-authored feature interviewing the filmmakers and creative team behind Toy Story 5. |
| `6ea7f294` | other | educational | Shares scientific details explaining the glacial sediment that colors Lake Argentino. |
| `10bbe25e` | paid_promotion | campaign | Promotes programming for a named, hashtagged broadcast series (#Sharkfest). |
| `5e342f4f` | other | campaign | Commemorates a national milestone with the #America250 campaign tag. |
| `069599b9` | product | other | Relies on a humorous trending meme concept without pitching specific product functionality. |
| `b898bca5` | paid_promotion | campaign | Promotes time-bound festival premieres and a dated theatrical film release. |
| `dbf6fadf` | other | campaign | Promotes the streaming premiere of the named series Secrets of the Penguins. |
| `98eabdc5` | educational | other | A one-line factual status announcement of a rocket launch. |
| `fbee2d1d` | educational | product | Uses video editing tips as a hook to promote and offer access to their proprietary tool. |
| `3bab6f42` | other | collaboration | Spotlights contributing photographer @nicholesobecki and her field experience in Sudan. |
| `92d73c54` | other | product | Pitches the Backup & Restore feature of the Smart Transfer application. |
| `5bec325d` | product | collaboration | Unpaid creator feature and institutional partner video spotlighting Antoni Porowski. |
| `1cd95442` | paid_promotion | other | A concise status announcement documenting a flight test milestone. |
| `b77ec204` | educational | campaign | Ties astronomical imagery to an Independence Day holiday push with festive hashtags. |
| `243193ca` | paid_promotion | collaboration | An unpaid institutional partner feature and spotlight celebrating the Rolex Explorer of the Year. |
| `4c71dd3c` | testimonial | campaign | A seasonal holiday promotional push centered on Mother's Day. |
| `363bb583` | collaboration | educational | The post shares an educational business lesson on brand building and community growth from an entrepreneur. |
| `6ec46938` | paid_promotion | collaboration | It promotes a collaborative documentary project featuring co-author Tom Hiddleston. |
| `4814b483` | product | other | A conversational engagement question about the World Cup with no direct product pitch or educational content. |
| `0a313966` | other | educational | The caption explains natural history facts regarding the courtship and breeding behavior of imperial cormorants. |
| `3fceb411` | other | educational | It educates readers on a newly discovered octopus species and its biological adaptations. |
| `d5cf5338` | other | educational | The caption details the biology, history, and water dependencies of African elephants. |
| `bff278ed` | collaboration | campaign | It is part of a named thematic series celebrating the 250th anniversary of U.S. independence. |
| `77104354` | collaboration | campaign | It is part of a designated time-bound awareness initiative (#EarthMonth) running throughout April. |
| `28dae4f3` | paid_promotion | testimonial | The creator endorses the product based on personal experience and user recommendation for their academy. |
| `a7066402` | paid_promotion | campaign | It promotes programming under a named seasonal programming block (#Sharkfest). |
| `7af0c948` | collaboration | educational | The post teaches readers about gray whale migration challenges and thermal-imaging conservation solutions. |
| `47442e9c` | paid_promotion | product | The post showcases the features of the account's upcoming AI tool and invites users to join the waitlist. |
| `03b18270` | product | testimonial | The post is framed as a first-person user endorsement sharing data recovery success with Dr.Fone. |
| `8e3fdbda` | collaboration | other | The caption is a short status update from astronauts aboard the ISS. |
| `c05190c1` | paid_promotion | other | The caption is a brief audience appreciation message with no other specific purpose. |
| `8486dba1` | collaboration | campaign | The post is tied to World Oceans Day and the Perpetual Planet campaign initiative. |
| `29445da2` | testimonial | collaboration | The post features and is co-authored with a creator showcasing her workflow. |
| `5a87352e` | educational | campaign | The caption promotes the streaming release of a named show series with a hashtag. |
| `6683bebf` | educational | testimonial | The post shares a user quote highlighting the positive impact of brand consistency. |
| `298ebf7f` | testimonial | educational | The caption provides tips and best practices for launching advertising campaigns. |
| `93e71324` | product | educational | The post explains astronomical discoveries about star clusters and brown dwarfs. |
| `171c01a0` | product | educational | The post teaches a quick iPhone setting tip for managing screenshots. |
| `ea6b6037` | campaign | product | The post announces new store features and offers a 30-day free trial. |
| `67ec4cd4` | other | educational | The post delivers detailed news and facts regarding an astronaut launch and ISS mission. |
| `b7845ce5` | collaboration | educational | The caption reports news and mission details regarding the Artemis III astronaut crew selection. |

</details>

