package com.veiltalk.video;

import java.util.UUID;

public record FinalizeVideoResponse(UUID id, String status, String message) {
}
