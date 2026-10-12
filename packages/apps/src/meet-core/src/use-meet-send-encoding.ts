import { useCallback, useEffect, useState } from "react";
import {
  readMeetLowData,
  subscribeMeetLowData,
  writeMeetLowData,
} from "@/meet-core/src/meet-low-data";
import type { MeetEncodingPrefs } from "@/meet-core/src/meet-send-encoding";

type EncodingClient = {
  setEncodingPrefs: (prefs: Partial<MeetEncodingPrefs>) => void;
};

/** Keep the live senders on the device's low-data flag without a new offer. */
export function useMeetSendEncoding(client: EncodingClient): {
  lowData: boolean;
  setLowData: (enabled: boolean) => void;
} {
  const [lowData, setLowDataState] = useState(readMeetLowData);

  useEffect(() => {
    const apply = () => {
      const next = readMeetLowData();
      setLowDataState(next);
      client.setEncodingPrefs({ lowData: next });
    };
    apply();
    return subscribeMeetLowData(apply);
  }, [client]);

  const setLowData = useCallback((enabled: boolean) => {
    writeMeetLowData(enabled);
  }, []);

  return { lowData, setLowData };
}
