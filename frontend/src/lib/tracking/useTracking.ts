import { useEffect, useState } from "react";
import { TrackingPipeline, type TrackingPipelineOptions } from "./trackingPipeline";

/** Hook sở hữu pipeline: unmount luôn dispose, không chỉ stop webcam. */
export function useTracking(options: TrackingPipelineOptions): TrackingPipeline | null {
  const [pipeline, setPipeline] = useState<TrackingPipeline | null>(null);

  useEffect(() => {
    const instance = new TrackingPipeline(options);
    setPipeline(instance);
    return () => {
      instance.dispose();
      setPipeline((current) => current === instance ? null : current);
    };
  }, [options]);

  return pipeline;
}
