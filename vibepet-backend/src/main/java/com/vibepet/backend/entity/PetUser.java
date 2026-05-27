package com.vibepet.backend.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "pet_user")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PetUser {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "device_uuid", nullable = false, unique = true, length = 64)
    private String deviceUuid;

    @Column(name = "nickname", nullable = false, length = 32)
    private String nickname;

    @Column(name = "avatar_url", length = 255)
    private String avatarUrl;

    @Column(name = "created_time", nullable = false, updatable = false)
    private LocalDateTime createdTime;

    @PrePersist
    protected void onCreate() {
        createdTime = LocalDateTime.now();
        if (nickname == null || nickname.trim().isEmpty()) {
            nickname = "神秘宠物训练师";
        }
        if (avatarUrl == null) {
            avatarUrl = "";
        }
    }
}
