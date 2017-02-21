// overlapping fix ranges are currently not supported (the ordered import range, and the missing comman do overlap)
import { autorun, computed } from "mbox";
import {
  isEmpty,
  isEqual
} from "lodash";

console.log(autorun, computed, isEmpty, isEqual);