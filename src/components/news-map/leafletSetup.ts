/**
 * Leaflet + GestureHandling bootstrap.
 *
 * Must be imported once before any <MapContainer> is rendered so that the
 * "gestureHandling" map option is available.
 */
import L from "leaflet";
import { GestureHandling } from "leaflet-gesture-handling";

import "leaflet/dist/leaflet.css";
import "leaflet-gesture-handling/dist/leaflet-gesture-handling.min.css";

L.Map.addInitHook("addHandler", "gestureHandling", GestureHandling);
