package com.vibepet.backend.repository;

import com.vibepet.backend.entity.PetUser;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.Optional;

@Repository
public interface PetUserRepository extends JpaRepository<PetUser, Long> {
    
    /**
     * 根据设备指纹 UUID 查询匿名用户
     * @param deviceUuid 机器指纹
     * @return 匿名用户包装类
     */
    Optional<PetUser> findByDeviceUuid(String deviceUuid);
}
