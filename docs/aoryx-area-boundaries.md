# Aoryx map area boundaries

`lib/aoryx-area-boundaries.json` is a stored snapshot of mapped
GeoJSON polygons retrieved on 2026-09-27. Coordinates are WGS84 `[longitude,
latitude]`. The app does not call a geocoding or boundary API at runtime;
hotel filtering uses point-in-polygon against these stored shapes.

This snapshot and the area list were copied from the agent.megatours.am Aoryx
implementation. Search results and the search form's map use the same boundaries.

Dubai polygons come from OpenStreetMap under the [ODbL](https://www.openstreetmap.org/copyright).
Feature IDs are:

| UI area | OSM feature(s) |
| --- | --- |
| Dubai Marina & JBR | [Marina relation 11912728](https://www.openstreetmap.org/relation/11912728), [JBR way 1011430642](https://www.openstreetmap.org/way/1011430642) |
| Palm Jumeirah | [way 874795235](https://www.openstreetmap.org/way/874795235) |
| Downtown Dubai | [relation 18471738](https://www.openstreetmap.org/relation/18471738) |
| Business Bay | [relation 18471755](https://www.openstreetmap.org/relation/18471755) |
| Al Barsha | [relation 15607818](https://www.openstreetmap.org/relation/15607818) |
| Jumeirah Village Circle | [way 874795302](https://www.openstreetmap.org/way/874795302) |
| Dubai Creek Harbour | [way 1012353010](https://www.openstreetmap.org/way/1012353010) |

Abu Dhabi polygons come from the [Abu Dhabi SDI/DGE open-data Districts layer](https://arcgis.sdi.abudhabi.ae/agspublish/rest/services/OpenData/ADSDI_OpenData/MapServer/4)
(copyright DGE 2024). The snapshot uses the `NAMEENGLISH` features `AL
SAADIYAT ISLAND`, `YAS ISLAND`, `AL REEM ISLAND`, `AL MARYAH ISLAND`, and
`KHALIFA CITY`. The source has reused numeric `DISTRICTID` values across
municipalities, so identify these features by exact name, not ID alone.

Deira, Corniche, and Al Raha Beach were removed from the selector because no
single verified matching boundary was found. Do not replace a missing polygon
with a circle or silently equate a wider administrative area with a tourism
neighborhood. All shapes reflect their source's mapped interpretation, not a
guarantee that a supplier's hotel coordinates are correct. When refreshing the
snapshot, verify feature names, polygon topology, attribution, and representative
hotel points before shipping.
