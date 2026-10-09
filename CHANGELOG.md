# Changelog

Versions follow `version` in `custom_components/waterheater_planner/manifest.json`.

## 0.21.0
- **Last heating** now adds up every heating for the same *Ready by*, so the night's and the day's heatings show as one. A heating that starts after *Ready by* begins the next one. Learning is unchanged.
- The chart draws planned heating in its own color (purple, CSS variable `--wh-plan-color`), so it no longer looks like heating that has run. Card version 0.4.0.
- Releases are automatic: when a push to `main` (a merged PR) carries a manifest version that has no tag yet, the release workflow creates the tag `vX.Y.Z` and the release with the zip. Pushing a tag by hand still works.

## 0.20.0
- **Simple or advanced set-up:** the first question when adding the integration (and under *Configure*) is *Simple* or *Advanced*. Simple asks only for the essentials, and the card shows only target temperature, comfort floor, ready by, energy correction, learn energy need, automatic and heat now. Advanced is everything, as before. Existing installations stay advanced; values set in advanced mode are kept when switching to simple. New status attribute `advanced`; card version 0.3.0.

## 0.19.0
- New card option `secondary_text: theme | bright | primary` (also in the card editor, *Grey texts*) for readability in dark themes. All grey text uses one CSS variable, `--wh-dim`, set on `ha-card`. Card version 0.2.0.

## 0.18.3
- **Grid re-heat limit:** a heating that began before a "Ready by" that has passed (it ran a little late and reached the target just after) no longer guards until the next day's "Ready by". The evening and night after it are planned as usual, so a shower at 19:00 is heated again in the cheapest hours before the next "Ready by".

## 0.18.2
- The surplus levels for the early start are settings now (Hybrid, shown when **Wait only if it saves** is on): **Early start at surplus** (default 25 % of the heater's power) and **Keep going until surplus below** (default 12 %).

## 0.18.1
- **Wait only if it saves** now only starts the heater earlier when there is solar surplus (a quarter of the heater's power to start, an eighth to keep going) and waiting would save less than the setting. Without sun to spare the plan is followed. Hybrid mode only; the plan itself is unchanged.

## 0.18.0
- New setting **Wait only if it saves** (`number` Wait for a cheaper hour only if it saves, öre/kWh): if waiting for a cheaper hour saves less than this per kWh, the heater may start earlier. 0 = off (as before).

## 0.17.0
- You can choose the card's icon: `icon_name: mdi:water-boiler` (or any Home Assistant icon; the card editor has an icon picker). Empty = the built-in tank icon. The colors still follow the state.

## 0.16.0
- The card has a tank icon left of the title and temperature. New option `icon: large | small | none` (also in the card editor; default `large`). The icon is turquoise while heating from the grid, yellow while heating on sun and dim when idle. A long status text now wraps inside its chip instead of pushing the buttons to a second row.

## 0.15.1
- The compact view has a line under the mode buttons that says when the next heating is planned (or that the heater is waiting for sun, for prices, or that nothing is needed).

## 0.15.0
- New card option `view: compact` (also in the card editor): shows the temperature, status, usage button and mode buttons, with a **Show more** button for the rest. `view: full` (default) is unchanged.

## 0.14.0
- Every setting in the card has an explanation: a tooltip on hover, and a tap on the label shows the text under the row (for touch screens).

## 0.13.0
- **Price the sun** now only changes how the cost is counted. What the heater does in sun hours the planner did not choose is a separate switch, **Sell surplus outside the chosen hours** (Solar mode with a price limit). Existing installs keep their behavior: the new switch starts with the value "Price the sun" had.

## 0.12.0
- New switch **Sun hours: only with surplus** (Solar mode with a price limit): the chosen sun hours heat only while there is real surplus and switch off when it falls away. The grid never fills in, so the plan costs 0 when the sun is free.

## 0.11.1
- **Grid re-heat only below** now works as a guard: it only holds from the moment a heating has reached the target until the next "Ready by". After "Ready by" it is reset and the planner plans the next heating as usual; it applies again only after a heating has reached the target. New attribute `regrid_armed`.

## 0.11.0
- The base temperature now also works in **Hybrid** mode: it is bought first in the cheapest hours before "Base temp ready by", and Hybrid plans the rest as usual. Cheapest mode still ignores it.

## 0.10.4
- The temperature on the card is clickable and opens the water temperature sensor's more-info dialog.
- The base temperature (and its time) can be set in the card's settings in every mode; it only has an effect in Solar mode.

## 0.10.3
- The status chip opens the heater switch's more-info dialog. The bar-chart button opens the usage popup (energy and cost today / this week / this month). The separate heater indicator (flame) is removed; the chip now glows while the heater is on.

## 0.10.2
- The status chip opens the heater switch's more-info dialog (like the heater indicator). The bar-chart button next to the indicator opens the status sensor's more-info dialog (history and attributes, including the new `usage`). The separate usage popup is gone.

## 0.10.1
- New status **Manual heating**: if the switch is turned on outside the planner (by hand or by another automation), the planner leaves it on until the target is reached or it is switched off (at most 6 hours) instead of turning it off again.
- The status chip is clickable and opens the status sensor's more-info dialog.

## 0.10.0
- Usage popup in the card (bar-chart button): energy and cost today, this week (from Monday) and this month, and how much was sun.
- Three optional settings in the integration: energy sensors for today / this week / this month (kWh). Without them the card uses what the integration has measured.
- Cost is kept per day (about 70 days) and exposed as sensors **Cost today / this week / this month**.

## 0.9.6
- New setting **Grid re-heat only below** (`number`): while the water is at or above it, no new grid heating is planned, so a night heating is not repeated during the day. Below it, the water is heated to the target again in the cheapest hours. The sun may still heat. 0 = off.

## 0.9.5
- On startup the heated history is filled in from Home Assistant's recorder (the last 24 h of the heater switch), so heatings from before the integration was installed or restarted show up in the chart. Backfilled runs have no known reason.

## 0.9.4
- The chart now really starts at 00:00 (the controller dropped prices older than two hours).
- Hover a coloured bar to see how long the heater ran in that quarter, the energy, and why.

## 0.9.3
- Documentation in English and Swedish, with screenshots, and GitHub Actions (tests, hassfest, HACS validation, release zip).
- Added `CONFIG_SCHEMA` (the integration is configured only through the UI).
- The status chip's text colour no longer depends on the surrounding theme.

## 0.9.2
- Click the heater indicator on the card to open the switch's more-info dialog.

## 0.9.1
- The card shows whether the switch is on (*Heating* / *Off*) next to the status.

## 0.9.0
- *Surplus to start* and *House base load* can be changed on the card and as entities, not only under Configure.

## 0.8.2
- The chart starts at 00:00 today and shows when the heater really ran.
- The *Last heating* line is always visible on the card.

## 0.8.1
- New switch *Price the sun*: with a sun-hour price limit, the sun can be priced as unsold electricity (on) or counted as free (off).

## 0.8.0
- In Solar mode with a price limit the sun is priced at the hour's electricity price, and surplus in unchosen hours is sold.

## 0.7.0
- Solar mode: a **price limit for sun hours**. Sun hours at or below it are open all the time, dearer ones are used cheapest-first.

## 0.6.0
- The card chart shows the heater's real running times from the last 24 hours.

## 0.5.0
- New sensors *Energy, last heating* and *Cost, last heating*, also on the card.

## 0.4.0
- Solar mode: an overnight **base temperature** that the grid heats to in the cheapest hours.

## 0.3.0
- The energy need **learns itself** from real heatings (switch *Learn energy need*, optional heater power sensor).

## 0.2.x
- Choose any existing price sensor in the settings.
- *Energy correction* (±%) for a wrong energy estimate.
- *Comfort floor, max price*.
- Fixed a cost bug in the planner, where a clipped slot counted as a whole slot.

## 0.1.0
- First version: Cheapest, Solar and Hybrid modes, planner, Lovelace card, config flow.
