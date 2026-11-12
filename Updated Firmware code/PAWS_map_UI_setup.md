# PAWS v5.0 estimated map hookup

## Setup

1. In Supabase, open **SQL Editor**, paste and run `PAWS_map_table_setup.sql`.
2. Flash `PAWSv1.2_CODEv5.0.ino` to the ESP32.
3. Open the serial monitor and look for `Map upload HTTP error`. A 2xx result means the point was accepted. If you see 404/400, check that the SQL ran and that the table is named exactly `paws_map_points`.
4. In the existing website, use the Supabase client to load the newest robot session, then fetch its points in `point_index` order.

## Website query example (Supabase JavaScript)

```js
const { data: newest, error: newestError } = await supabase
  .from("paws_map_points")
  .select("session_id")
  .eq("robot_id", "PAWS_V1")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (newestError) throw newestError;
if (!newest) return; // The robot has not uploaded a map point yet.

const { data: points, error } = await supabase
  .from("paws_map_points")
  .select("point_index,event_type,x_cm,y_cm,heading_deg,sensor_bearing_deg,obstacle_range_cm,obstacle_x_cm,obstacle_y_cm,created_at")
  .eq("robot_id", "PAWS_V1")
  .eq("session_id", newest.session_id)
  .order("point_index", { ascending: true });

if (error) throw error;
const path = points.filter(p => p.event_type === "origin" || p.event_type === "pose");
const obstacles = points.filter(p => p.event_type === "obstacle");
// Draw path as a line through (x_cm, y_cm); draw obstacle markers at
// (obstacle_x_cm, obstacle_y_cm). Coordinates are centimeters, +Y is forward
// at the start, and +X is to the robot's right.
```

## Map interpretation and calibration

This is dead-reckoning from commanded gait cycles, not SLAM. Each completed forward/backward gait cycle currently adds/subtracts 5 cm; each completed turn cycle changes heading by 30 degrees. Adjust `ESTIMATED_CM_PER_GAIT_CYCLE` and `ESTIMATED_DEG_PER_TURN_CYCLE` near the top of the sketch after measuring the robot over a known distance and turn. The displayed position will drift because actual foot slip, load, battery voltage, and floor friction are not measured.

Obstacle coordinates are estimated from the current robot pose, measured ultrasonic/ToF distance, and the sensor's assumed pan angle. The front reading uses the nearer valid ToF or ultrasonic measurement; side scans use the panning ultrasonic sensor. If your pan mechanism faces the opposite direction, swap the signs of the left/right sensor bearings in `updateNavigation()`.

The firmware creates a new random `session_id` each boot and uploads the origin after Wi-Fi is connected. It does not buffer points while offline. Pose uploads are throttled to once every three seconds to reduce pauses from network requests; origin and obstacle points are sent immediately.

The SQL policies above are intentionally open for a classroom/demo prototype because the firmware uses a public Supabase anon key. They permit anonymous reads and inserts. Do not use these policies for a public or production deployment; secure writes behind an authenticated endpoint or device-specific credentials.

The website source was not present in the supplied workspace, so this package provides the database table and exact query/data contract; the existing UI still needs to draw `path` and `obstacles` using its map component.
